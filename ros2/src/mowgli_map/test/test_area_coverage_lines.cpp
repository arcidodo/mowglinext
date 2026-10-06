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
// Unit tests for the pure per-area coverage-line helpers: normalisation of the
// angle, rejection of bad values, and the "a cleared override leaves nothing
// behind" rule the persisted map relies on.

#include <cmath>
#include <limits>

#include "mowgli_map/area_coverage_lines.hpp"
#include <gtest/gtest.h>

using mowgli_map::AreaCoverageLines;
using mowgli_map::CheckCoverageLines;
using mowgli_map::FoldMowAngleDeg;

TEST(AreaCoverageLines, DefaultsToFollowingTheRobotWideSettings)
{
  const AreaCoverageLines lines;
  EXPECT_FALSE(lines.has_mow_angle);
  EXPECT_FALSE(lines.has_ring_direction);
  EXPECT_EQ(lines.mow_angle_deg, 0.0);
  EXPECT_EQ(lines.ring_direction, 0);
}

TEST(AreaCoverageLines, AngleIsFoldedIntoZeroToOneEighty)
{
  EXPECT_DOUBLE_EQ(FoldMowAngleDeg(0.0), 0.0);
  EXPECT_DOUBLE_EQ(FoldMowAngleDeg(30.0), 30.0);
  EXPECT_DOUBLE_EQ(FoldMowAngleDeg(179.0), 179.0);
  EXPECT_DOUBLE_EQ(FoldMowAngleDeg(180.0), 0.0);
  EXPECT_DOUBLE_EQ(FoldMowAngleDeg(200.0), 20.0);
  EXPECT_DOUBLE_EQ(FoldMowAngleDeg(-30.0), 150.0);
  EXPECT_DOUBLE_EQ(FoldMowAngleDeg(-180.0), 0.0);
  EXPECT_DOUBLE_EQ(FoldMowAngleDeg(540.0), 0.0);
}

TEST(AreaCoverageLines, FoldNeverReturnsOneEighty)
{
  // fmod of a tiny negative value plus 180 rounds up to exactly 180.
  EXPECT_LT(FoldMowAngleDeg(-1e-18), 180.0);
  EXPECT_GE(FoldMowAngleDeg(-1e-18), 0.0);
}

TEST(AreaCoverageLines, ZeroDegreesAndPlannerDefaultAreRealChoices)
{
  const auto check = CheckCoverageLines(true, 0.0, true, 0);
  ASSERT_TRUE(check.ok);
  EXPECT_TRUE(check.lines.has_mow_angle);
  EXPECT_EQ(check.lines.mow_angle_deg, 0.0);
  EXPECT_TRUE(check.lines.has_ring_direction);
  EXPECT_EQ(check.lines.ring_direction, 0);
}

TEST(AreaCoverageLines, ClearingAnOverrideDropsItsValue)
{
  const auto check = CheckCoverageLines(false, 123.0, false, 2);
  ASSERT_TRUE(check.ok);
  EXPECT_EQ(check.lines, AreaCoverageLines{}) << "a cleared override must leave no stale number";
}

TEST(AreaCoverageLines, EachValueIsIndependent)
{
  const auto angle_only = CheckCoverageLines(true, 45.0, false, 2);
  ASSERT_TRUE(angle_only.ok);
  EXPECT_TRUE(angle_only.lines.has_mow_angle);
  EXPECT_FALSE(angle_only.lines.has_ring_direction);
  EXPECT_EQ(angle_only.lines.ring_direction, 0);

  const auto dir_only = CheckCoverageLines(false, 45.0, true, 2);
  ASSERT_TRUE(dir_only.ok);
  EXPECT_FALSE(dir_only.lines.has_mow_angle);
  EXPECT_EQ(dir_only.lines.mow_angle_deg, 0.0);
  EXPECT_TRUE(dir_only.lines.has_ring_direction);
  EXPECT_EQ(dir_only.lines.ring_direction, 2);
}

TEST(AreaCoverageLines, AnAngleOutsideTheRangeIsFoldedNotRejected)
{
  const auto check = CheckCoverageLines(true, 250.0, false, 0);
  ASSERT_TRUE(check.ok);
  EXPECT_DOUBLE_EQ(check.lines.mow_angle_deg, 70.0);
}

TEST(AreaCoverageLines, ANegativeAngleMeansAutoNotAFoldedAngle)
{
  // Negative = auto is the convention of mow_angle_deg everywhere; -30 must not
  // become 150 degrees. It lets one area plan on auto while the robot-wide angle is fixed.
  for (const double negative : {-1.0, -30.0, -0.001, -720.0})
  {
    const auto check = CheckCoverageLines(true, negative, false, 0);
    ASSERT_TRUE(check.ok) << negative;
    EXPECT_TRUE(check.lines.has_mow_angle) << negative;
    EXPECT_EQ(check.lines.mow_angle_deg, mowgli_map::kMowAngleAutoDeg) << negative;
  }
  // Zero is the other side of the line: a real 0 degrees, not auto.
  EXPECT_EQ(CheckCoverageLines(true, 0.0, false, 0).lines.mow_angle_deg, 0.0);
}

TEST(AreaCoverageLines, RejectsNonFiniteAngles)
{
  EXPECT_FALSE(CheckCoverageLines(true, std::numeric_limits<double>::quiet_NaN(), false, 0).ok);
  EXPECT_FALSE(CheckCoverageLines(true, std::numeric_limits<double>::infinity(), false, 0).ok);
  // ...but a non-finite value that is not being set is ignored, not an error.
  EXPECT_TRUE(CheckCoverageLines(false, std::numeric_limits<double>::quiet_NaN(), false, 0).ok);
}

TEST(AreaCoverageLines, RejectsAnUnknownWinding)
{
  const auto bad = CheckCoverageLines(false, 0.0, true, 3);
  EXPECT_FALSE(bad.ok);
  EXPECT_FALSE(bad.message.empty());
  EXPECT_FALSE(CheckCoverageLines(false, 0.0, true, 255).ok);
  EXPECT_TRUE(CheckCoverageLines(false, 0.0, true, 1).ok);
  EXPECT_TRUE(CheckCoverageLines(false, 0.0, true, 2).ok);
  // An ignored value is not validated.
  EXPECT_TRUE(CheckCoverageLines(false, 0.0, false, 9).ok);
}
