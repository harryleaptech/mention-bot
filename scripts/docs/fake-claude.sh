#!/bin/sh
# Stands in for `claude` while recording the docs: answers like a finished board task after
# 3 seconds, so a run fits in a short clip and uses no Claude usage.
cat > /dev/null
sleep 3
printf '%s' '{"type":"result","is_error":false,"session_id":"demo-session-0001","result":"**Done.** Added `tests/Unit/ReplyLengthTest.php` with 3 cases (empty, at the limit, over the limit).\n\n- Files changed: tests/Unit/ReplyLengthTest.php\n- Tests: 3/3 passed\n- Left for you: review and push."}'
