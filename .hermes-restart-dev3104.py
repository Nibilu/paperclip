import os
import signal
import subprocess
import time

source_pid = 556822
env = {}
with open(f"/proc/{source_pid}/environ", "rb") as handle:
    for item in handle.read().split(b"\x00"):
        if b"=" in item:
            key, value = item.split(b"=", 1)
            env[key.decode()] = value.decode()

for pid in (556822, 556806, 556627):
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass

time.sleep(3)
for pid in (556822, 556806, 556627):
    try:
        os.kill(pid, 0)
        os.kill(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass

time.sleep(2)
command = [
    "/home/amber/.nvm/versions/node/v24.19.0/bin/node",
    "--require",
    "/home/amber/paperclip/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/preflight.cjs",
    "--import",
    "file:///home/amber/paperclip/node_modules/.pnpm/tsx@4.23.15/node_modules/tsx/dist/loader.mjs",
    "src/index.ts",
]
process = subprocess.Popen(
    command,
    cwd="/home/amber/paperclip/server",
    env=env,
    stdout=subprocess.DEVNULL,
    stderr=subprocess.DEVNULL,
    start_new_session=True,
)
print(f"started_pid={process.pid} port={env.get('PORT')} database_configured={bool(env.get('DATABASE_URL'))}")
