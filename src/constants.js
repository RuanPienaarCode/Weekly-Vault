'use strict';
/* Shared constants. */

/* The id is fortnight-planner, never a bare `fortnight`: a store plugin once
   took Nudge's bare id and Obsidian's update check overwrote ours with it.
   The view type follows the id so the two can never collide. */
const VIEW_TYPE = 'fortnight-planner-view';
const ICON = 'calendar-range';

const DEFAULT_SETTINGS = {
  weekStart: 1,
};

module.exports = { VIEW_TYPE, ICON, DEFAULT_SETTINGS };
