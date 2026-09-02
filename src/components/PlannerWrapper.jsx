import { useState, useEffect } from "react";
import { sb } from "../lib/supabase.js";
import CalendarView from "../features/planner/CalendarView.jsx";

// Fetches saved outfit_logs on mount and passes them to CalendarView so the
// "pick a saved look" tab inside the day modal has something to show.
// `available` is what she may pick from right now; `wardrobe` + `closets` ride
// along for trip planning, which resolves across both closets (Phase B).
// The vocabulary is defined in features/closet/useVisibleWardrobe.js.
export default function PlannerWrapper({ available, wardrobe, closets, activeCloset, onRefreshActiveTrip, onItemsClosetChanged, apiKey, onGoToStyleMe, onEditItem, onEditPlan, onBuildDay }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    sb.fetchOutfitLogs().then(setLogs).catch(() => {});
  }, []);
  return <CalendarView
    available={available}
    wardrobe={wardrobe}
    closets={closets}
    activeCloset={activeCloset}
    onRefreshActiveTrip={onRefreshActiveTrip}
    onItemsClosetChanged={onItemsClosetChanged}
    outfitLogs={logs}
    apiKey={apiKey}
    onGoToStyleMe={onGoToStyleMe}
    onEditItem={onEditItem}
    onEditPlan={onEditPlan}
    onBuildDay={onBuildDay}
  />;
}
