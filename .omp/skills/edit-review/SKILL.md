---
name: edit-review
description: Review the currently made edits to prepare for commit.
---
Steps:

1. Considering the conversation made so far to identify the problem these edits intend to fix and look for.
2. Check if the project still builds.
2. Check `git diff` to see the current edit, for these edits, look for:
- Extra or missing empty lines made
- Accidentally deleted lines that are unrelated to the purpose of the edits
    For example (issue in audio playing is to be fixed but lines related to play history are deleted)
3. review if there are any newly made (untracked) files created in the course of the conversation. There will be some unlreated files untracked in the repo but not all of them have to be reviewed.
