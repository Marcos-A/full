#!/bin/bash
# Starts a built app and waits for its page to finish starting, which runs everything up to and
# including navigator.locks. Prints the launch time. Usage: mac-app-reaches-ready.sh <app> [arch]
set -u
app=$1
arch=${2:-}
log=$(mktemp)
started=$(perl -MTime::HiRes=time -e 'printf "%.0f", time * 1000')
if [ -n "$arch" ]; then
  FULL_TIMINGS=$started arch "-$arch" "$app/Contents/MacOS/full" 2> "$log" &
else
  FULL_TIMINGS=$started "$app/Contents/MacOS/full" 2> "$log" &
fi
pid=$!
result=1
for _ in $(seq 1 120); do
  if grep -q 'timing ready' "$log"; then
    result=0
    break
  fi
  if grep -q 'start-failed' "$log"; then
    break
  fi
  kill -0 "$pid" 2>/dev/null || break
  sleep 0.5
done
kill "$pid" 2>/dev/null
wait "$pid" 2>/dev/null
cat "$log"
if [ "$result" != 0 ]; then
  echo "::error::The app's page never finished starting (${arch:-native})"
fi
exit "$result"
