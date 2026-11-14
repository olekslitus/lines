//! Whether a site's name stands only for addresses on the web at large, which src/lib/outside.ts
//! asks before it follows an address something on the web gave (a feed, a page, a picture): so a
//! name such as `127.0.0.1.nip.io` can't lead the app to this computer or the network it's on,
//! which web pages can't reach but the app can.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, ToSocketAddrs};
use std::sync::mpsc;
use std::time::Duration;

/// How long the system has to say what a name stands for.
const LOOKUP_TIME: Duration = Duration::from_secs(5);

/// Whether every address `host` stands for is on the web at large. Fails, rather than letting it
/// be asked, where the system can't say in time: a name's server failing once to answer a second
/// time with this computer's address is how a check like this is got round.
#[tauri::command]
pub async fn host_is_public(host: String) -> Result<bool, String> {
  tauri::async_runtime::spawn_blocking(move || resolves_publicly(&host)).await.map_err(|error| error.to_string())?
}

/// The system's answer for `host`, every address of it public; an error where it has none in time.
fn resolves_publicly(host: &str) -> Result<bool, String> {
  let name = host.trim_start_matches('[').trim_end_matches(']').to_string();
  let (answer, answered) = mpsc::channel();
  // A lookup can't be stopped: it's left to finish on a thread of its own, unheard.
  std::thread::spawn(move || {
    let _ = answer.send((name.as_str(), 443).to_socket_addrs().map(|addresses| addresses.map(|address| address.ip()).collect::<Vec<_>>()));
  });
  match answered.recv_timeout(LOOKUP_TIME) {
    Ok(Ok(addresses)) if !addresses.is_empty() => Ok(addresses.into_iter().all(is_public)),
    Ok(Ok(_)) => Err(format!("{host} stands for no address")),
    Ok(Err(error)) => Err(format!("couldn't look up {host}: {error}")),
    Err(_) => Err(format!("couldn't look up {host} in time")),
  }
}

/// Whether an address is on the web at large: not this computer, its network, a link's own, shared
/// by a carrier, or one kept for something else (documentation, broadcasts, groups, what's reserved).
/// An IPv6 address that carries an IPv4 one (mapped, compatible, NAT64, 6to4) is as that one is.
pub fn is_public(ip: IpAddr) -> bool {
  match ip {
    IpAddr::V4(v4) => is_public_v4(v4),
    IpAddr::V6(v6) => match carried(v6) {
      Some(v4) => is_public_v4(v4),
      None => {
        let [first, second, ..] = v6.segments();
        // Teredo (2001::/32) tunnels to anywhere; site-local (fec0::/10) is a network's own; 2001:db8::/32 is documentation's.
        let teredo = first == 0x2001 && second == 0;
        let documentation = first == 0x2001 && second == 0x0db8;
        let site_local = first & 0xffc0 == 0xfec0;
        !(teredo || documentation || site_local || v6.is_loopback() || v6.is_unspecified() || v6.is_unique_local() || v6.is_unicast_link_local() || v6.is_multicast())
      }
    },
  }
}

/// The IPv4 address an IPv6 one carries: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d), NAT64's
/// (64:ff9b::/96, and the local 64:ff9b:1::/48, its u-octet skipped) or 6to4's (2002::/16).
fn carried(v6: Ipv6Addr) -> Option<Ipv4Addr> {
  let o = v6.octets();
  let s = v6.segments();
  if let Some(v4) = v6.to_ipv4_mapped() {
    return Some(v4);
  }
  if s[..6] == [0; 6] && !(v6.is_loopback() || v6.is_unspecified()) {
    return Some(Ipv4Addr::new(o[12], o[13], o[14], o[15]));
  }
  if s[..6] == [0x64, 0xff9b, 0, 0, 0, 0] {
    return Some(Ipv4Addr::new(o[12], o[13], o[14], o[15]));
  }
  if s[..3] == [0x64, 0xff9b, 1] {
    return Some(Ipv4Addr::new(o[6], o[7], o[9], o[10]));
  }
  if s[0] == 0x2002 {
    return Some(Ipv4Addr::new(o[2], o[3], o[4], o[5]));
  }
  None
}

fn is_public_v4(v4: Ipv4Addr) -> bool {
  let [a, b, c, _] = v4.octets();
  // 0.0.0.0/8 is "this network", 100.64.0.0/10 a carrier's, shared by those behind it, 192.0.0.0/24
  // the protocols' own, and 240.0.0.0/4 reserved (with the broadcast address). 198.18.0.0/15 is
  // left public: proxies that hand out a fake address for every name (Clash, Surge) use it, and
  // refusing it would refuse every site behind one.
  let this_network = a == 0;
  let shared = a == 100 && (b & 0xc0) == 64;
  let protocols = a == 192 && b == 0 && c == 0;
  let reserved = a >= 240;
  !(this_network || shared || protocols || reserved || v4.is_private() || v4.is_loopback() || v4.is_link_local() || v4.is_documentation() || v4.is_multicast())
}

#[cfg(test)]
mod tests {
  use super::*;

  fn public(address: &str) -> bool {
    is_public(address.parse().unwrap())
  }

  #[test]
  fn on_the_web_at_large() {
    for address in ["8.8.8.8", "93.184.215.14", "172.32.0.1", "100.128.0.1", "198.18.0.1", "198.19.255.254", "2606:4700:4700::1111", "64:ff9b::808:808", "2002:808:808::1"] {
      assert!(public(address), "{address}");
    }
  }

  #[test]
  fn this_computer_and_its_networks_arent() {
    for address in ["127.0.0.1", "10.0.0.2", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::", "fd00::1", "fe80::1"] {
      assert!(!public(address), "{address}");
    }
  }

  #[test]
  fn reserved_arent() {
    for address in ["255.255.255.255", "240.0.0.1", "192.0.0.8", "192.0.2.1", "224.0.0.1", "fec0::1", "2001::1", "2001:0:4136:e378::1", "2001:db8::1", "ff02::1"] {
      assert!(!public(address), "{address}");
    }
  }

  #[test]
  fn an_ipv4_address_carried_in_ipv6_is_as_it_is() {
    for address in ["::ffff:127.0.0.1", "::ffff:192.168.1.1", "::127.0.0.1", "::10.0.0.1", "64:ff9b::7f00:1", "64:ff9b::a9fe:a9fe", "64:ff9b:1:7f00:0:100::", "2002:7f00:1::1", "2002:c0a8:101::1"] {
      assert!(!public(address), "{address}");
    }
    assert!(public("::ffff:8.8.8.8"));
    assert!(public("64:ff9b:1:808:8:800::"));
  }

  #[test]
  fn names_for_this_computer_arent() {
    // Answered by the system's own hosts file, not the network.
    assert_eq!(resolves_publicly("localhost"), Ok(false));
    assert_eq!(resolves_publicly("127.0.0.1"), Ok(false));
    assert_eq!(resolves_publicly("[::1]"), Ok(false));
  }

  #[test]
  fn a_name_that_cant_be_looked_up_fails() {
    // `.invalid` never stands for anything (RFC 6761), so it's answered without the network.
    assert!(resolves_publicly("nothing.invalid").is_err());
  }
}
