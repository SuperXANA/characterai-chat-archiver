# Character.AI manual archive

This script adds a small archive panel to the Character.AI chat already open in your signed-in Google Chrome tab. You issue each command yourself. It writes a readable text file and a companion JSONL journal to a folder you choose on your computer.

**Start with “Save entire currently loaded conversation” and “Save all loaded variants of this reply.”** These commands can preserve text already in the page without changing the selected swipe. Then use the previous/next controls one step at a time when needed.

## What it can recover

- The completed character replies currently loaded in the page, including alternatives present in inactive carousel slides.
- The preceding user message, when that message is loaded, to identify each reply's context.
- Displayed swipe counters, actual loaded-slide counts, timestamps, chat URL, and character name.
- The original rendered response HTML in the JSONL journal, preserving bold, italics, and other formatting alongside the plain text.
- Your preferred variant, recorded locally as a separate entry. The other variants remain in the archive.

**The attached HTML exposes a carousel only for the newest character reply. Its second slide is empty and has a `2 / 100` counter. Older replies have no swipe controls in that snapshot.** The script therefore treats `100` as an observed UI denominator, which may represent a limit. It cannot certify that 100 historical alternatives exist.

If Character.AI no longer exposes a historical reply's alternatives through its page, this DOM-based script cannot retrieve them. It never uses “Rewind message to here,” “Remove message,” or other message-menu actions to expose them. Saving every accessible variant does not establish that every historical variant has been recovered.

## Start in your existing Chrome tab

You do not need Python, Selenium, ChromeDriver, a debugging port, a new Chrome profile, or another login for this version. It runs as a Chrome DevTools Snippet.

1. Extract the ZIP. Open `character_ai_manual_archive.js` in a text editor and review it. Copy the complete file.
2. In Chrome, open the intended Character.AI character **and the specific conversation** you want to preserve. Keep your existing signed-in tab open.
3. Press **F12** or **Ctrl+Shift+I** to open DevTools. Select **Sources**. In the left sidebar, choose **Snippets**; it may be under the **»** overflow menu.
4. Click **New snippet**, give it a name such as `CAI manual archive`, and paste the complete script into the editor. Press **Ctrl+S** to save it. If Chrome displays a paste-protection prompt, review the script and follow Chrome's prompt for this snippet.
5. Press **Ctrl+Enter** with the snippet editor focused, or click its Run button. A **Character.AI manual archive** panel appears in the chat page. You can close DevTools while you use the panel.
6. Change **Archive filename stem** to a name for this specific conversation, for example `Pimedasus-chat-01`, `Sweet-Dreams-chat-02`, or `Rusa-Imperio-chat-01`. Leave off the extension.
7. Click **Choose / reopen archive folder**. Choose a dedicated export folder and grant the requested file access. The page receives access to that folder, so use a folder intended for these exports.

The panel creates, or resumes, two matching files:

```text
Pimedasus-chat-01.txt
Pimedasus-chat-01.jsonl
```

Existing archive records are retained. An unrelated file or a different chat URL causes the operation to stop. Use a new filename stem for a different chat. Avoid running two exporters against the same files at the same time.

## Your manual command loop

After each command the panel reports its result and waits. It never advances through a sequence of swipes on its own.

| Command | What happens |
| --- | --- |
| Rescan loaded replies | Refreshes the list of character replies currently in the page. It does not scroll or load the entire history automatically. |
| Loaded character reply | Selects which response the archive commands apply to. The list uses DOM order; the supplied page places the newest reply first. |
| Show selected reply | Scrolls the selected reply into view. |
| Save current swipe | Saves the selected reply's active, completed variant. |
| Save all loaded variants of this reply | Saves every completed alternative already loaded for that reply, including inactive slides. It does not change the selected swipe. |
| Previous stored swipe / Next stored swipe | Saves the current response, checks for an already completed adjacent slide, saves that target, moves exactly one step, and saves the resulting active response. A failed save prevents movement. |
| Mark current as preferred | Saves the current variant and appends your preference to the files. It does not edit the chat. |
| More actions → Save entire currently loaded conversation | Saves completed variants and their preceding user prompts for every character reply currently loaded. Empty or generating slides are skipped. This batch reads and saves; it does not navigate swipes. |
| More actions → Close archive panel | Removes the exporter panel. All completed saves remain on disk. |

For your example, you can save swipe 15, work backward through available earlier alternatives, move forward again when needed, and mark 15 as preferred. Saving an alternative never removes it from Character.AI. A preferred marker also leaves every saved alternative in the archive.

To preserve a long conversation:

1. Choose the output folder and a filename stem for that chat.
2. Use **Save entire currently loaded conversation** to preserve what is present now. This may take a while because each reply is checked for stable text and each record is committed individually.
3. Select a reply with a carousel. Use **Save all loaded variants of this reply** first.
4. Use **Previous stored swipe** or **Next stored swipe** for individual moves. The panel waits after each one.
5. If the script reports an unloaded or unknown destination, it leaves the page unchanged. You may expose an **existing** alternative with Character.AI's own controls, then use **Save current swipe**. Avoid the site's circular refresh / regenerate control when preserving existing content.
6. Scroll within the conversation to load older history, click **Rescan loaded replies**, and repeat the save commands. The script does not assume that content outside the DOM has been saved.
7. Keep copies of **both** export files on another drive or backup location.

## Navigation protection

The script never clicks Character.AI's buttons, opens message menus, types into the chat box, or sends a message. Its swipe movement uses the existing Swiper carousel's `slideTo` method only after verifying the current index and finding completed text in the adjacent target slide.

An empty placeholder is never selected. In the supplied HTML, the button labelled **Next** uses a refresh icon and sits beside an empty alternative. The script does not interpret that button as proof of another stored response.

When a carousel is virtualized, looped, still moving, missing its control API, or has inconsistent indices, automatic movement is refused. Capture commands remain available for text the page exposes. Changing swipes may cause Character.AI's own normal page behavior; the script itself makes no direct HTTP requests and uses no private API endpoints.

## Saving and resuming

- The `.txt` file contains readable response text, the preceding prompt, and metadata for each capture. Text whitespace is normalized into readable paragraphs.
- The `.jsonl` file is the structured journal. Each line is a JSON record. It also includes the response HTML so formatting is retained separately from the readable text.
- Each journal entry and text entry is written with existing bytes retained, and its writable stream is closed before a swipe can change. Closing a stream commits that file's write; the two files are separate commits.
- If the text write fails after the journal succeeds, movement stops. Reopen the same archive after fixing the disk or permission issue; missing text entries are reconstructed from the journal.
- Repeated captures of the same identified variant and unchanged content are skipped. Identical words at distinct identified swipe positions are retained. Changed text or formatting is saved as a new snapshot.
- Unknown message identities use page-session identifiers. After a page reload or DOM replacement, another capture may produce a duplicate. This favors retaining material over mistakenly merging separate replies.
- **Optional turn reference** lets you give the selected reply a stable label, such as `chapter-4-prompt-27`, when you need to resume across page reloads. Use a different label for each distinct reply. This does not create swipe IDs that the site has not exposed.
- A page refresh removes the running panel. Run the saved DevTools snippet again, choose the same filename stem and folder, and resume. Previously committed files are independent of the open tab.
- If a file has an incomplete or malformed record, the script stops and preserves it. Continue under a new filename stem rather than deleting the original.

## Troubleshooting

**No panel:** Check the DevTools Console for a script error. Run the full snippet on an HTTPS `character.ai` chat page, rather than a character profile or a login page. Another Character.AI layout may use different selectors.

**No local folder picker:** Use a normal desktop Google Chrome window on the HTTPS chat page. Chrome or organization policy may restrict local file access. Canceling or denying permission stops the operation without moving a swipe.

**“Selected reply changed or unloaded”:** Scroll the reply into view, click Rescan, and select it again. Character.AI can remove off-screen messages from the DOM.

**“Chat URL changed”:** Select the intended conversation, rescan, and choose its matching archive. The full URL, including chat-identifying query parameters, is retained; a changed URL is treated conservatively as a different chat.

**“No completed adjacent swipe”:** This does not certify that you reached the end of every historical alternative. It means no completed adjacent alternative is present in the DOM. The panel returns to waiting.

**Historical replies have no alternatives:** The supplied snapshot has this limitation. The exporter cannot expose those alternatives through the forbidden rewind/removal actions. Preserve the displayed text while it remains available.

## Validation

The code passed JavaScript syntax checking and 10 offline tests using a small DOM adapter, simulated file handles, and a sanitized structural fixture derived from the supplied HTML. All original conversation wording and identities were replaced in the distributed fixture.

The tests cover empty-placeholder handling, prompt association in the reverse-ordered chat, navigation boundaries, carousel state mismatches, Unicode and formatting retention, preserving distinct alternatives with identical text, changed-text snapshots, archive resumption, interrupted text writes, external file-size changes, and stopping navigation on a disk error.

The script has **not been run against your private signed-in Character.AI account**, and this environment had no runnable local Chrome for a full browser test. Start by saving one displayed reply and checking the files. Then save loaded variants before trying one navigation command. A future site layout change may require selector updates.

Developers can run the included tests with Node.js 20 or later:

```sh
node --test tests/test_archive.cjs
```

Node.js is needed only for those optional offline tests, not for running the exporter in Chrome.

## Primary technical references

- [Chrome DevTools: Run JavaScript snippets](https://developer.chrome.com/docs/devtools/javascript/snippets)
- [Chrome: File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Swiper API: existing carousel instances and slide methods](https://swiperjs.com/swiper-api)
