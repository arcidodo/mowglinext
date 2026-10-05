// Copyright 2026 Mowgli Project
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
/**
 * @file area_coverage_lines.hpp
 * @brief Per-area coverage-line overrides (mow angle, perimeter winding) — pure, no ROS deps.
 *
 * Each mowing area may carry its own swath angle and perimeter winding. Both are
 * OPT-IN overrides of the robot-wide `mow_angle_deg` / `mow_direction` settings:
 * a flag per value, and the zero value of everything means "follow the
 * robot-wide setting". That is what keeps an areas.dat or an add_area request
 * written before these fields existed meaning exactly what it meant before, and
 * keeps "0 degrees" and "planner default winding" expressible as real choices.
 */
#pragma once

#include <cmath>
#include <cstdint>
#include <string>

namespace mowgli_map
{

/// Highest valid perimeter winding: 0 planner default, 1 clockwise, 2 counter-clockwise
/// (the values of coverage_server.ring_direction).
inline constexpr uint8_t kMaxRingDirection = 2;

/// The mow_angle_deg value that means AUTO (any negative value does, everywhere on this robot).
inline constexpr double kMowAngleAutoDeg = -1.0;

struct AreaCoverageLines
{
  bool has_mow_angle{false};
  /// Degrees in [0, 180), or kMowAngleAutoDeg to pin the area to AUTO even when the
  /// robot-wide angle is fixed. Meaningful only when has_mow_angle; 0 otherwise.
  double mow_angle_deg{0.0};
  bool has_ring_direction{false};
  /// 0 / 1 / 2. Meaningful only when has_ring_direction; 0 otherwise.
  uint8_t ring_direction{0};

  [[nodiscard]] bool operator==(const AreaCoverageLines& o) const
  {
    return has_mow_angle == o.has_mow_angle && mow_angle_deg == o.mow_angle_deg &&
           has_ring_direction == o.has_ring_direction && ring_direction == o.ring_direction;
  }
};

/// A swath has no sense of direction (serpentine order alternates it), so 200
/// degrees and 20 degrees are the same lines: fold into [0, 180).
[[nodiscard]] inline double FoldMowAngleDeg(double deg)
{
  double folded = std::fmod(deg, 180.0);
  if (folded < 0.0)
  {
    folded += 180.0;
  }
  // fmod of a tiny negative value can round up to exactly 180.
  return folded >= 180.0 ? 0.0 : folded;
}

struct CoverageLinesCheck
{
  bool ok{false};
  std::string message;  ///< Failure reason when !ok.
  AreaCoverageLines lines;
};

/// Validate and normalise a request. A value whose has_* flag is false is
/// DROPPED (stored as 0) so a cleared override never leaves a stale number on
/// disk. An angle is folded into [0, 180); a negative one means AUTO and is
/// stored as exactly kMowAngleAutoDeg.
[[nodiscard]] inline CoverageLinesCheck CheckCoverageLines(bool has_mow_angle,
                                                           double mow_angle_deg,
                                                           bool has_ring_direction,
                                                           uint8_t ring_direction)
{
  CoverageLinesCheck out;
  if (has_mow_angle && !std::isfinite(mow_angle_deg))
  {
    out.message = "mow_angle_deg must be a finite number";
    return out;
  }
  if (has_ring_direction && ring_direction > kMaxRingDirection)
  {
    out.message =
        "ring_direction must be 0 (planner default), 1 (clockwise) or 2 "
        "(counter-clockwise)";
    return out;
  }
  out.lines.has_mow_angle = has_mow_angle;
  if (has_mow_angle)
  {
    out.lines.mow_angle_deg =
        mow_angle_deg < 0.0 ? kMowAngleAutoDeg : FoldMowAngleDeg(mow_angle_deg);
  }
  out.lines.has_ring_direction = has_ring_direction;
  out.lines.ring_direction = has_ring_direction ? ring_direction : 0;
  out.ok = true;
  return out;
}

}  // namespace mowgli_map
