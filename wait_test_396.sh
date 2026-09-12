while kill -0 $(ps aux | grep "[/]bin/bash ./run-regressions.sh" | awk '{print $2}') 2>/dev/null; do
  sleep 2
done
