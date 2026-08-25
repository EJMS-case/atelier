import { useState, useEffect } from "react";
import { sb } from "../lib/supabase.js";
import CalendarView from "../features/planner/CalendarView.jsx";

// Fetches saved outfit_logs on mount and passes them to CalendarView so the
// "pick a saved look" tab inside the day modal has something to show.
// `items` is the scoped pool; `allItems` + `closets` ride along for trip
// planning, which needs to see both closets (Phase B).
export default function PlannerWrapper({ items, allItems, closets, activeCloset, onRefreshActiveTrip, onItemsClosetChanged, apiKey, onGoToStyleMe, onEditItem, onEditPlan, onBuildDay }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    sb.fetchOutfitLogs().then(setLogs).catch(() => {});
  }, []);
  return <CalendarView
    items={items}
    allItems={allItems}
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
