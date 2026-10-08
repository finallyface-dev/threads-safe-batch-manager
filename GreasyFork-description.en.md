# Threads Follower and Following Batch Manager (Confirm & Stop)

Preview your Threads followers or following list, select the accounts you want to manage, and confirm the batch before removing followers or unfollowing accounts one at a time.

If you find this script useful, please give it a star on [GitHub](https://github.com/finallyface-dev/threads-safe-batch-manager).

## Features

- Separate modes for removing followers and unfollowing accounts.
- A read-only preview of every account collected for the batch.
- Individual checkboxes, Select all, and Deselect all. Only selected accounts are processed.
- Up to 50 accounts per batch, with a default of 10. Batches above 25 show an additional warning.
- An adjustable delay of 8–30 seconds and an estimate of waiting time. Page loading and confirmation take additional time.
- Typed batch confirmation and a final confirmation dialog.
- Pause after the current account, explicitly skip a paused item, or stop and clear the batch.
- Automatic pause when account identity changes, controls are unclear, or Threads displays verification, errors, or action limits.

## How to use

1. Install the userscript with a userscript manager and sign in to Threads.
2. Open your own profile and close any existing followers or following dialog.
3. Choose Remove followers or Unfollow, then set the batch size and delay.
4. Click Scan and preview. Review the accounts and deselect any you want to keep.
5. Click Confirm and start, enter the requested confirmation phrase, and accept the final confirmation.
6. Keep the tab open while the script visits each selected profile. Use the pause or stop controls when needed.

The current panel labels and confirmation phrases are in Traditional Chinese. The script recognizes supported Threads controls in Traditional Chinese, Simplified Chinese, and English.

Removing a follower does not unfollow that account. Unfollowing an account does not remove them as your follower, block them, or report them.

## Privacy and limitations

The script uses visible Threads page controls. It does not use private APIs, collect login credentials, send account lists to the author, load external code, or include ads or telemetry.

Batch data is stored in the current tab's `sessionStorage`. Threads page code on the same origin can access this storage. The target queue is removed after completion. A summary remains until you clear it or close the tab.

The script is not affiliated with or authorized by Meta. Automated scanning and relationship changes may lead to verification prompts or account restrictions. The batch cap and delay do not guarantee account safety.

Threads interface changes may cause the script to pause. An unknown action result is not automatically retried. Reloading the page or navigating through browser history pauses the batch. Relationship changes already sent to Threads cannot be undone by this script.

## License and source

MIT License. Source code and issue reports are available on [GitHub](https://github.com/finallyface-dev/threads-safe-batch-manager).
