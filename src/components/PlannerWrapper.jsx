import { useState, useEffect } from "react";
import { sb } from "../lib/supabase.js";
import CalendarView from "../features/planner/CalendarView.jsx";

// Fetches saved outfit_logs on mount and passes them to CalendarView so the
// "pick a saved look" tab inside the day modal has something to show.
export default function PlannerWrapper({ items, apiKey, onGoToStyleMe, onEditItem, onEditPlan, onBuildDay }) {
  const [logs, setLogs] = useState([]);
  useEffect(() => {
    sb.fetchOutfitLogs().then(setLogs).catch(() => {});
  }, []);
  return <CalendarView
    items={items}
    outfitLogs={logs}
    apiKey={apiKey}
    onGoToStyleMe={onGoToStyleMe}
    onEditItem={onEditItem}
    onEditPlan={onEditPlan}
    onBuildDay={onBuildDay}
  />;
}
