# sensors/ — working notes for Claude

Three self-contained LiDAR images run **beside** `mowgli-ros2` and talk to it only over DDS (`lidar-ldlidar/`, `lidar-rplidar/`, `lidar-stl27l/`). The Universal GNSS sidecar is built and published by its own repository; `gps/` contains only the Mowgli adapter and its tests. `mavros/` is deliberately different: it is the source-free MowgliNext integration contract for the independently built MowgliMAVROS sidecar, not an image or a source vendor. The only ROS node this tree owns is `gps/mowgli_gnss_bridge`.
It must NOT own: which containers run, device paths, udev symlinks, `docker/.env` or the compose fragments (installer — see `install/CLAUDE.md`); the `GnssStatus.msg` schema (`ros2/src/mowgli_interfaces`); or any consumer of `/gps/*` and `/scan` (see `ros2/CLAUDE.md`). Nothing here publishes TF or a pose — root CLAUDE.md Invariants 1–2.

## Read next

| File | Read it when… |
|------|---------------|
| [`docs/claude/codemaps/deploy.md`](../docs/claude/codemaps/deploy.md) | Anything in this tree — it is the codemap for `install/` + `docker/` + `sensors/`: file inventory, `.env`→fragment→container→ROS-param table, change-coupling, pitfalls. |
| [`docs/claude/ros-interfaces.md`](../docs/claude/ros-interfaces.md) | Renaming/retyping `/gps/fix`, `/gps/status`, `/rtcm`, `/scan`, or checking who consumes them. |
| [`docs/claude/parameters.md`](../docs/claude/parameters.md) | Touching a `gnss_*` key in `mowgli_robot.yaml` (§ *GNSS / NTRIP*) or a `GNSS_*`/`LIDAR_*` `.env` key. |
| [`docs/claude/testing-ci.md`](../docs/claude/testing-ci.md) | Adding a sensor image or changing what CI asserts about one. |
| [`docs/claude/codemaps/mowgli_interfaces.md`](../docs/claude/codemaps/mowgli_interfaces.md) | Changing `GnssStatus.msg` enums / `CAP_*` bits — the bridge's projection target. |
| [`docs/claude/codemaps/mowgli_localization.md`](../docs/claude/codemaps/mowgli_localization.md) | Tracing `/gps/fix` downstream (`navsat_to_absolute_pose_node` → `fusion_graph`). |
| [`docs/claude/doc-index.md`](../docs/claude/doc-index.md) | Before trusting any prose doc here — it lists which are stale and what replaced them. |
| [`wiki/Sensors.md`](../wiki/Sensors.md) | Operator-facing GNSS contract + the 2026-06 F9P/UM982 field-validation notes. **Partly stale** (see gotchas). |
| [`wiki/Deployment.md`](../wiki/Deployment.md) | The compose stack these containers sit in, from the operator's side. |
| [`sensors/README.md`](README.md) | User-facing sensor overview / "how to add a sensor". **Partly stale** (see gotchas). |
| [`mavros/README.md`](mavros/README.md) | The external sidecar's image pin, MowgliNext orchestration boundary, device/config mounts, and static integration validation. |

## Build · test · run

```bash
# LiDAR images — context is the sensor directory
docker build -t mowgli-lidar-ldlidar --target runtime sensors/lidar-ldlidar/
docker build -t mowgli-lidar-stl27l  --target runtime sensors/lidar-stl27l/
docker build -t mowgli-lidar-rplidar sensors/lidar-rplidar/     # CI passes no target

# Cheap host-side checks (all that runs off-robot)
bash -n sensors/gps/start_gps.sh
python3 -m py_compile sensors/gps/universal_gnss_topic_bridge.py

# Resolver dry-run: prints the receiver_node / bridge / ntrip_node commands, launches nothing.
# In-container only — it needs the /opt/gnss_sidecar overlay (start_gps.sh:395-404) and
# exits 1 when the resolved serial device is absent (L459). On the robot:
docker exec -e GNSS_DRY_RUN=true mowgli-gps /start_gps.sh

# Live logs on the robot (installer-provided helpers, install/lib/tools.sh)
mowgli-gps-logs ; mowgli-lidar-logs
```

`mowgli_gnss_bridge`'s tests run in the **`Test mowgli_gnss_bridge` job of `sensors-gps.yml`**. That job assembles a minimal workspace containing `mowgli_interfaces`, `universal_gnss_msgs` and the bridge, then runs `colcon test --packages-select mowgli_gnss_bridge` and asserts the gtest XML reports a non-zero case count. Do not add `universal_gnss_ros2` or any UG runtime library to this workspace: the production `mowgli-ros2` image has the same interface-only boundary, while receiver/NTRIP/replay remain in `mowgli-gps`.

CI: one thin caller per LiDAR image (`.github/workflows/sensors-lidar-{ldlidar,rplidar,stl27l}.yml`) → reusable `_sensor-docker.yml` (amd64 + arm64, push-by-digest then manifest merge). `sensors-gps.yml` publishes no image: it assembles the three-package interface/bridge workspace and executes the bridge tests.

## Conventions

- **This package is uncrustify-styled, NOT clang-format-styled — do not clang-format it.** It sits outside `ros2/src/`, so the repo's formatter never sees it: `ros2/scripts/format.sh` globs `ros2/src/` only, `.githooks/pre-push` amends `ros2/src/` only, and a parent-dir lookup from `sensors/` never finds `ros2/.clang-format`. Because clang-format has never run here, the code follows **ament's uncrustify profile** instead, and `ament_uncrustify` is left ENABLED in the package's `CMakeLists.txt` (unlike every `ros2/src` package, which mutes it) so that stays true. Running clang-format over it would restyle ~180 lines of working code and then fail that linter. Format with `ament_uncrustify --reformat` from the package directory — easiest inside `ros:kilted-ros-base` with `ros-kilted-ament-uncrustify` installed. `ament_copyright` IS muted, for the usual reason: the project declares licensing with an SPDX identifier, which ament does not recognise. `cpplint` is also enabled — mind its 100-column limit.
- Node conventions in [`.claude/rules/ros2.md`](../.claude/rules/ros2.md) apply to `mowgli_gnss_bridge`: declare every param in the constructor, explicit QoS (status/diagnostics reliable depth 10, RTCM depth 50 — `universal_gnss_topic_bridge.cpp:291–292`).
- **Two bridge implementations must stay behaviour-identical**: C++ by default, `GNSS_BRIDGE_IMPL=python` falls back to `universal_gnss_topic_bridge.py` with identical `--ros-args` (`start_gps.sh:529–545`). A projection change lands in C++ **and** Python **and** the gtest.
- Shell: `set -euo pipefail`; config resolution is always **YAML → env → built-in default**, never the reverse.
- Dockerfiles pin upstream drivers by ref/SHA (`LDLIDAR_REF` / `LDLIDAR_SHA`) and patch them with `sed` **inside the Dockerfile**. Never vendor a patched upstream source tree into this repo.
- Fixed public contract: `/gps/fix` (NavSatFix), `/gps/status` (`mowgli_interfaces/GnssStatus`), `/rtcm` (`rtcm_msgs/Message`), `/diagnostics`, `/scan` (LaserScan). GNSS `frame_id: gps_link`, LiDAR `frame_id: lidar_link`.

## Component-specific gotchas

- **universal-gnss is a pinned submodule used only for public interfaces.** A bump means re-pinning the gitlink; never copy its runtime packages into a Mowgli workspace or image. The official external sidecar reference is release `v0.1.3-rc1`.
- **Adding a default to `install/compose/docker-compose.gps.yml` masks the operator's YAML.** Empty `GNSS_*` env values are deliberate ("not set") — the resolvers (`start_gps.sh:66–376`) read `/config/mowgli_robot.yaml` first.
- **`parse_yaml` is grep+sed, not a YAML parser** (`start_gps.sh:25–35`): it takes the FIRST indented `key:` anywhere in the file, regardless of which node's block it belongs to, and strips exactly one quote pair. Its `|| true` is load-bearing under `set -e` — remove it and a missing key aborts the container before the fallbacks apply.
- **The receiver-profile apply must finish and release the port** before `receiver_node` opens it (`start_gps.sh:469–512`) — only one process can hold the serial device. Its failure is deliberately non-fatal (a pre-configured receiver still runs); do not make it fatal.
- **NTRIP `centipede/centipede` fallback fires only for caster `crtk.net`** (`start_gps.sh:177–215`), mirrored in `install/lib/env.sh` — keep both in sync. Never commit a real `GNSS_NTRIP_PASSWORD` into config, docs or logs.
- `/gps/status` and `/rtcm` are the **public mirrors**; the real receiver↔NTRIP path is the private `/_gps_internal/universal/{status,rtcm}` (`start_gps.sh:417–418`). Do not point consumers at the internal names.
- **`GNSS_STACK=disabled` is rejected by the sidecar itself** (`start_gps.sh:389`) — "no GNSS" is expressed by not composing the container at all, in `install/lib/compose.sh`.
- **ldlidar ignores `LIDAR_PORT` / `LIDAR_BAUD`**: `/dev/lidar` @ 230400 is hardcoded in `ldlidar.yaml:6–7`. Only the rplidar/stl27l fragments pass those through as `command:` overrides.
- **`lidar.bins: 455` is deliberate** (`ldlidar.yaml:15–19`): the upstream `ldlidar_stl_ros2` driver jitters 499–503 readings per revolution, and `bins` forces a fixed-length resample. Don't "tidy" it away.
- **The ldlidar image carries three mandatory build patches** (`lidar-ldlidar/Dockerfile:56–92`): FATAL_ERROR→WARNING for the humble/jazzy distro gate, `count_subscribers(_scanTopic)` → `_scanPub->get_subscription_count()` (the relative-name lookup always returns 0, so the driver reports NO SUBSCRIBERS and publishes nothing), and an explicit `libldlidar.so` copy (upstream never installs it, and the runtime stage copies only `/ros2_ws/install`).
- **`LIDAR_ENABLED` in `.env` only decides whether the container is composed.** The ROS-side LiDAR mode is `mowgli_robot.yaml:lidar_enabled` (root Invariant 15, `docs/claude/parameters.md`) — starting this container does not enable scan-matching or the LiDAR Nav2 overlay.
- **Both prose docs here are partly stale**: `sensors/README.md` points at a sensors/lidar/ directory and a `docker.yml` workflow that no longer exist; `wiki/Sensors.md` still describes `GNSS_STACK=legacy`, the sensors/unicore/ and sensors/nmea/ trees and `mowgli_bringup/universal_gnss.launch.py` — all removed. Prefer `docs/claude/codemaps/deploy.md`, and fix the doc rather than coding to it.
- **Images are multi-arch (amd64 + arm64)**; the robot is arm64. Anything arch-specific (a prebuilt `.so`, an x86 binary, a `--platform` pin) breaks only the arm64 leg — i.e. only the real robot. `rplidar`'s caller sets no `target:` while ldlidar/stl27l pin `target: runtime`; copy the right caller shape when adding a sensor.

## Safety

These containers do not command motion, but they feed the two signals that gate it: `/scan` (collision_monitor + FTC obstacle deviation) and the GNSS fix behind `/gps/status` and the fused pose (BT localization gating, and the dig detector's stand-down — root Invariant 16). A silently dead or wrongly-framed publisher here reads downstream as "clear ahead" or "position is fine". Treat topic-contract, `frame_id`, QoS and driver-pin changes as safety-relevant in PR reviews (root CLAUDE.md § *Safety*), and never add a software e-stop or blade path here — the firmware is the sole blade/e-stop authority.
