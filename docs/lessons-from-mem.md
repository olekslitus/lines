# Lessons from Mem

[Mem](https://get.mem.ai) was an AI notes app: write without filing, and let the app find, connect and organize. It [announced on 2026-11-16 that it's shutting down](https://get.mem.ai/blog/mem-is-shutting-down). Notes go read-only on 2026-12-18 and the service closes on 2027-01-15. It was built for seven years on about $29M of venture money: a $5.6M seed from Andreessen Horowitz in 2021, and a $23.5M Series A led by the OpenAI Startup Fund in November 2022 ([TechCrunch](https://techcrunch.com/2022/11/10/ai-powered-note-taking-app-mem-raises-23-5m-openai/)).

This page records what Mem did, what people liked and didn't, and what lines takes from it, written in November 2026. The spikes that came out of it are listed [at the end](#what-lines-is-doing-about-it).

## What Mem was

From Mem's own [retrospective](https://get.mem.ai/blog/mem-is-shutting-down), in order:

| Year | What |
|---|---|
| 2021 | **Spotlight**: a shortcut on the Mac to write a note from anywhere. **Search** by dates, links and people. |
| 2022 | **Similar Mems**: notes related by meaning, without filing. **Smart Write & Edit**: AI writing that drew on your notes. **Mem X**, the paid AI tier. |
| 2023 | **"The new Mem"** ([post](https://get.mem.ai/blog/the-new-mem)): a turn from notes app to "personalized knowledge assistant". Tasks, templates, daily and scheduled notes, People, Calendar, Comments, the Inbox and the desktop app were cut, to focus on Chat, Search, Collections and Similar Mems. |
| 2023–24 | **Collections**, suggested for each note, and new ones proposed as themes emerged. **Mem Chat**: questions answered from your notes, with links to them. |
| 2025 | **Mem 2.0** ([transition guide](https://get.mem.ai/blog/mem-2-dot-0-transition-guide)), rebuilt as an "AI thought partner": offline-first, Voice Mode, a Chrome extension, Deep Search, side-by-side and agentic chat, templates back. Removed again: the Task and People views, the Inbox, automatic Gmail sync, Comments, Telegram and X capture. Meeting notes without a bot joining the call. |
| 2026 | **Heads Up** and **Meeting Briefings** (context during and before meetings), a **ChatGPT app and MCP connector**, and **Mem Agent**: follow-ups by iMessage, WhatsApp, email and Slack. Then the shutdown. |

## What people liked

From reviews, forums and Hacker News over the years. Review aggregators are summaries and partly the work of competitors, so this leans on first-hand comments where there are any.

- **Capture with no decisions.** The thing early users praised most. "on desktop, you just start typing anywhere and it enters into a new note, and from mobile you can text anything … to a specific number and it goes to a new note" ([HN, 2021](https://news.ycombinator.com/item?id=27820000)). Obsidian, by contrast, met them with "a wall of choices — which folder? which file?" The same commenter called it "initial capture friction/anxiety". Others: "they have reduced the cognitive load of writing" ([HN, 2022](https://news.ycombinator.com/item?id=30522503)), and "I love that I am now unconcerned about tags or folders or categories" ([HN, 2023](https://news.ycombinator.com/item?id=36317639)).
- **Finding things by meaning.** Similar Mems was held up as the reference for "related notes" ([HN, 2023](https://news.ycombinator.com/item?id=34430804)). It was the feature Obsidian users then rebuilt as plugins (Smart Connections).
- **Writing and asking with your own notes as context.** "it uses your knowledgebase to assist in your writing … it's also got built in chat with your knowledgebase, and helps with auto-sorting" ([HN, 2023](https://news.ycombinator.com/item?id=36314655)).
- **A calm, polished interface** with a soft learning curve ([Mac Power Users](https://talk.macpowerusers.com/t/mem-your-mind-on-tap-dangerous/22833)).
- **Mem 2.0's rebuild**: faster, offline editing, version history. Product Hunt reviewers singled out fast capture and AI search ([Product Hunt](https://www.producthunt.com/products/mem-2-0/reviews)). Late on, some said Mem Agent's deadlines and briefings changed their day ([summary of reviews](https://www.tryorbye.com/products/mem)).

## What people didn't like

- **Features taken away, twice.** In 2023 and again in 2025, features people had built habits on were cut: tasks, templates, daily notes, the Inbox, People, comments, email sync. Support answered with a form reply that templates and daily and scheduled notes were "deprecated for new customers", which one user called "shooting themselves in the foot" ([Outliner Software](https://www.outlinersoftware.com/topics/viewt/10193)). Each time, people had to rebuild how they worked.
- **Less control as the AI took over.** The early free beta encouraged "lightweight organization". Later versions gave less control and leaned on the AI to organize ([Outliner Software](https://www.outlinersoftware.com/topics/viewt/10193)). Reviewers found "the self-organizing graph is hard to audit" and the folderless design hard to get used to ([reviews summary](https://www.tryorbye.com/products/mem)). Agentic chat sometimes edited the wrong note.
- **Privacy, from the start.** Notes lived on Mem's servers and were read by its AI (OpenAI's models, which Mem said weren't trained on them: [support article](https://support.mem.ai/article/146-is-my-data-used-to-train-ai-models)). Some read the valuation as being about "the data that can be mined". "mem.ai doesn't sound very privacy friendly" ([HN, 2021](https://news.ycombinator.com/item?id=27812398)). For one critic it was "a non-customizable tool where someone else owns your data and seems to offer no data portability" ([HN, 2023](https://news.ycombinator.com/item?id=36318641)). Sign-in was by Google only: "What if your google account gets locked! You lose access to your external brain too!" ([Mac Power Users](https://talk.macpowerusers.com/t/mem-your-mind-on-tap-dangerous/22833)).
- **Slow, and buggy.**
  - It was buggy from sign-up ([HN, 2021](https://news.ycombinator.com/item?id=28895740)), and "it's been buggy" ([HN, 2021](https://news.ycombinator.com/item?id=27811275)).
  - Reviewers called it sluggish enough to spoil quick capture, and its search slow. People asked for plain, instant keyword search.
  - Sync across devices was glitchy, with edits made on two devices at once conflicting ([reviews summary](https://www.tryorbye.com/products/mem)).
- **Mobile neglected.** The iPhone app was described as laggy, with unreliable sync, no iPad layout and no PDF export. There was never an Android app. A team that used Mem to think in public stopped, puzzled by how little it cared about mobile ([myICOR](https://myicor.com/why-weve-stopped-using-mem-as-our-pkms-shallow-thinking-tool-at-the-paperless-movement)).
- **No way to see everything.** There was no clear way to "zoom out and look at all your notes, like a file explorer, graph view, or whatever" ([HN, 2021](https://news.ycombinator.com/item?id=27811275)).
- **Missing basics for some.** No math or LaTeX, "even after all that money raised" ([HN, 2022](https://news.ycombinator.com/item?id=33637799)). No block editor or transclusion ([Medium, 2022](https://medium.com/@hshawjr/the-great-note-taking-app-purge-of-2022-50e62c96b9c4)). Voice Mode was English only. Meeting recordings stopped after two hours.
- **Price and limits.**
  - Every plan came to have monthly message caps, and an email to Mem counted as a message ([pricing](https://get.mem.ai/pricing)).
  - Trackers of pricing pages report Pro going from $12 a month, unlimited, to $29 with caps in August 2026. That's from snapshots, not an announcement ([usagepricing](https://www.usagepricing.com/blueprint/activity/mem-2026-08-25-metered-tier-ladder)).
  - "the price is getting hard to justify for a personal note-taker when competitors are catching up on AI features" (a review quoted by [Saner](https://blog.saner.ai/mem-ai-reviews), a competitor).
- **An unclear way out.** Mem's export is a ZIP its guide says can be opened as an Obsidian vault, and its format isn't documented ([migration guide](https://help.mem.ai/migration)). The migration guide recommends no successor. On the shutdown thread on Hacker News, the first comment asked whether anyone still used Mem ([HN, 2026](https://news.ycombinator.com/item?id=50526537)).

## What lines takes from it

1. **Capture without deciding is the feature.** Mem's best-loved idea was the absence of a question: no folder, no file, no title, just write. lines already has an Inbox that takes new notes until they're filed, and tags instead of folders. Quick Note from anywhere ([#74](https://github.com/olekslitus/lines/issues/74)) is the next step, and the most important one for anyone coming from Mem.
2. **AI that organizes has to show its work, and ask.** Mem's organizing grew opaque, and its agent sometimes edited the wrong note. In lines, suggestions are visible (a tag offered, not applied), applied with a click, and undone with Undo. Answers link to the notes they came from ([#374](https://github.com/olekslitus/lines/issues/374)).
3. **Your notes stay yours, on your device.** The longest-running complaint about Mem was where the notes lived, who read them, and that losing a Google account or the company meant losing them. lines' notes are files and a database on the device, synced where the person chooses. Its AI, if any, runs on the device first, and sends nothing anywhere unless asked ([#374](https://github.com/olekslitus/lines/issues/374)). When Mem closes, its users lose the service. lines can't close on anyone like that: the app keeps working and the notes stay on the device.
4. **Don't take features away.** Mem cut tasks, templates, daily notes, the Inbox and email twice, and each time people rebuilt their habits or left. lines makes features plugins that can be turned off, rather than removing them, and keeps its formats readable without lines (Markdown, Linedown).
5. **Fast first, smart second.** Mem was called sluggish, its search slow. lines keeps search instant and adds meaning-based results below as they come ([#376](https://github.com/olekslitus/lines/issues/376)), never making typing or capture wait on a model. `bun run bench` guards it.
6. **Mobile is not an afterthought.** Mem's neglected iPhone app and missing Android app lost it users. lines builds for iPhone, iPad and Android from the same code as the desktop and web apps, and what doesn't work there yet is written down ([limitations.md](limitations.md#the-iphone-ipad-and-android-apps)).
7. **Let people see all their notes.** Mem never showed the whole of what you'd written. lines has the note list, tags, types, the calendar and the Library, each a way to look at everything.
8. **Keep it affordable to run.** A product that sends every note to a paid model has to charge per message, and Mem's caps grew while its price rose. On-device models cost the person nothing per question. Remote ones use the person's own key, so lines never needs to meter thinking.
9. **Be a good place to land.** Mem's users have until 2027-01-15. An importer that keeps their collections, links, dates and meetings ([#375](https://github.com/olekslitus/lines/issues/375)), with a page saying where each Mem feature is in lines, is worth more to them now than any new feature.

## What lines is doing about it

The spikes this research produced, and the issues they build on:

| Issue | What |
|---|---|
| [#375](https://github.com/olekslitus/lines/issues/375) | Import from Mem, before it shuts down |
| [#374](https://github.com/olekslitus/lines/issues/374) | AI in lines, local-first: where models run, what they may read, off by default |
| [#376](https://github.com/olekslitus/lines/issues/376) | Related notes and search by meaning, on the device |
| [#377](https://github.com/olekslitus/lines/issues/377) | Ask your notes, with answers that link to them, and Clean Up and write from them |
| [#378](https://github.com/olekslitus/lines/issues/378) | Suggested tags and types, and themes noticed across new notes |
| [#379](https://github.com/olekslitus/lines/issues/379) | Follow-ups from notes, and briefings before a calendar event |
| [#74](https://github.com/olekslitus/lines/issues/74) | Quick Note: capture from anywhere |
| [#61](https://github.com/olekslitus/lines/issues/61) | An MCP server for AI apps, off by default |
| [#13](https://github.com/olekslitus/lines/issues/13) | Voice notes and meeting recordings, with on-device transcripts |
| [#77](https://github.com/olekslitus/lines/issues/77) | Calendar: meeting notes from events |
| [#64](https://github.com/olekslitus/lines/issues/64) | Save to lines from anywhere |

## Sources, and how far to trust them

- **Mem's own pages:** the [shutdown post and retrospective](https://get.mem.ai/blog/mem-is-shutting-down), ["The new Mem" (2023)](https://get.mem.ai/blog/the-new-mem), the [Mem 2.0 transition guide](https://get.mem.ai/blog/mem-2-dot-0-transition-guide), the [migration guide](https://help.mem.ai/migration), [pricing](https://get.mem.ai/pricing), and a [support article on training](https://support.mem.ai/article/146-is-my-data-used-to-train-ai-models). These are facts about what Mem did, in Mem's words.
- **First-hand comments:** Hacker News threads from 2021 to 2026 ([search](https://hn.algolia.com/?q=mem.ai)), [Mac Power Users](https://talk.macpowerusers.com/t/mem-your-mind-on-tap-dangerous/22833) and [Outliner Software](https://www.outlinersoftware.com/topics/viewt/10193). Individual voices, not a survey.
- **Review aggregators** ([tryorbye](https://www.tryorbye.com/products/mem), [Saner](https://blog.saner.ai/mem-ai-reviews), G2, App Store summaries): useful for what came up repeatedly, but they summarize without dates, and some are competitors. Claims that rest only on them (pricing history, two-hour recordings, wrong-note edits) are marked as such above.
- **Not reached:** Reddit, which blocked automated reading, and RuntimeWire's article on the shutdown, which is behind a sign-in.
