// ── ATELIER STYLES ───────────────────────────────────────────────────────────
// Shared inline style objects used across the feature components. Split into
// three groups for historical reasons: `s` is the general palette, `si` are
// insights-specific, `ss` are sets-specific. Components that only use a
// handful can cherry-pick.

export const s = {
  app: { minHeight:"100vh", background:"var(--color-surface)", fontFamily:"'DM Sans',system-ui,sans-serif", color:"var(--color-ink)", overflowX:"hidden" },

  // Header — width:100% guards against horizontally-overflowing children
  // (e.g. the nav row on narrow iPhones) leaving a gap to the right of the
  // dark band. The inner container scrolls horizontally if needed.
  header: { background:"var(--color-ink)", position:"sticky", top:0, zIndex:100, borderBottom:"1px solid var(--color-ink-2)", width:"100%" },
  headerInner: { maxWidth:900, margin:"0 auto", padding:"0 16px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between", gap:8 },
  brand: { display:"flex", alignItems:"center", gap:8, flexShrink:0 },
  brandMark: { color:"var(--color-accent)", fontSize:16 },
  brandName: { color:"var(--color-surface)", fontSize:13, letterSpacing:"0.25em", fontFamily:"'DM Sans',sans-serif" },
  savedPill: { background:"var(--color-success)", color:"#fff", borderRadius:10, padding:"2px 8px", fontSize:10, fontFamily:"sans-serif" },
  // Nav scrolls horizontally on narrow phones so the dark header band stays
  // edge-to-edge even when there are more chips than fit. justify:flex-end
  // keeps the icons right-aligned on wider screens.
  nav: { display:"flex", gap:2, alignItems:"center", overflowX:"auto", flexWrap:"nowrap", flex:"1 1 auto", justifyContent:"flex-end", scrollbarWidth:"none", WebkitOverflowScrolling:"touch" },
  navBtn: { background:"none", border:"none", color:"var(--color-text-muted)", fontSize:12, letterSpacing:"0.08em", padding:"6px 8px", cursor:"pointer", borderRadius:3, display:"flex", alignItems:"center", gap:4, whiteSpace:"nowrap", flexShrink:0 },
  navActive: { color:"var(--color-surface)" },
  badge: { background:"var(--color-accent)", color:"var(--color-ink)", borderRadius:10, padding:"1px 6px", fontSize:10, fontFamily:"sans-serif" },

  // Page
  page: { maxWidth:900, margin:"0 auto", padding:"24px 20px 160px", position:"relative" },
  pageHeader: { display:"flex", alignItems:"center", gap:14, marginBottom:24 },
  pageTitle: { fontSize:20, fontWeight:400, letterSpacing:"0.05em", margin:0 },
  backBtn: { background:"none", border:"none", color:"var(--color-text-2)", fontSize:13, cursor:"pointer", padding:0 },

  // Filter (legacy — kept for queue rows etc.)
  chipRow: { display:"flex", gap:8, flexWrap:"wrap", marginBottom:24 },
  chip: { background:"none", border:"1px solid var(--color-border-muted)", color:"var(--color-text-2)", fontSize:11, letterSpacing:"0.08em", padding:"5px 13px", borderRadius:20, cursor:"pointer", transition:"all 0.15s ease" },
  chipActive: { background:"var(--color-ink)", borderColor:"var(--color-ink)", color:"var(--color-surface)", fontWeight:500, boxShadow:"0 2px 8px rgba(28,24,20,0.25)" },

  // Grid
  grid: { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:14 },

  // Card
  card: { background:"#fff", borderRadius:8, overflow:"hidden", border:"1px solid var(--color-border)", position:"relative" },
  cardImg: { height:190, background:"var(--color-surface)", overflow:"hidden", cursor:"pointer" },
  cardPhoto: { width:"100%", height:"100%", objectFit:"contain" },
  cardPlaceholder: { width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, color:"var(--color-border-muted)", fontFamily:"sans-serif" },
  cardBody: { padding:"10px 12px 10px" },
  cardCat: { fontSize:9, letterSpacing:"0.15em", color:"var(--color-text-muted)", marginBottom:3 },
  cardName: { fontSize:13, lineHeight:1.3, marginBottom:3 },
  cardColor: { fontSize:11, color:"var(--color-text-2)" },
  cardNotes: { fontSize:10, color:"var(--color-text-muted)", fontStyle:"italic", marginTop:2 },
  cardActions: { display:"flex", gap:4, padding:"0 8px 8px", justifyContent:"flex-end" },
  iconBtn: { background:"none", border:"none", cursor:"pointer", color:"var(--color-border-muted)", padding:4, display:"flex", alignItems:"center" },

  // Empty
  empty: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"80px 20px", gap:16 },
  emptyMark: { fontSize:36, color:"var(--color-border-muted)" },
  emptyText: { color:"var(--color-text-muted)", fontSize:14, textAlign:"center" },

  // Spinners. `spinnerSm` is the muted dark spinner used on light backgrounds.
  // `spinnerSmLight` is the inverse for use on dark buttons (btnPrimary).
  spinner: { display:"inline-block", width:28, height:28, border:"2px solid var(--color-border)", borderTop:"2px solid var(--color-ink)", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  spinnerSm: { display:"inline-block", width:11, height:11, border:"1.5px solid var(--color-border-muted)", borderTop:"1.5px solid var(--color-ink)", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  spinnerSmLight: { display:"inline-block", width:11, height:11, border:"1.5px solid rgba(255,255,255,0.3)", borderTop:"1.5px solid #fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" },

  // Style panel — capped at 65vh so it stops dominating the iPhone screen.
  // The panel still scrolls internally, so all controls remain reachable.
  stylePanel: { position:"fixed", bottom:0, left:0, right:0, background:"#fff", borderTop:"1px solid var(--color-border)", padding:"12px 16px", zIndex:50, boxShadow:"0 -4px 20px rgba(0,0,0,0.08)", maxHeight:"65vh", overflowY:"auto" },
  panelLabel: { fontSize:10, letterSpacing:"0.22em", color:"var(--color-text-muted)", marginBottom:10 },
  panelRow: { display:"flex", gap:8, marginBottom:8 },
  select: { flex:1, border:"1px solid var(--color-border)", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"var(--color-ink)" },
  input: { flex:1, border:"1px solid var(--color-border)", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"var(--color-ink)", outline:"none" },
  err: { color:"var(--color-danger)", fontSize:12, margin:"4px 0 0" },
  btnPrimary: { background:"var(--color-ink)", color:"var(--color-surface)", border:"none", borderRadius:4, padding:"10px 20px", fontSize:12, letterSpacing:"0.08em", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 },
  btnSecondary: { background:"none", border:"1px solid var(--color-border)", borderRadius:4, padding:"10px 20px", fontSize:12, color:"var(--color-text-2)", cursor:"pointer", letterSpacing:"0.06em", textAlign:"center" },
  fab: { position:"fixed", bottom:200, right:20, width:48, height:48, borderRadius:24, background:"var(--color-ink)", color:"var(--color-surface)", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 16px rgba(0,0,0,0.22)", zIndex:60 },

  // Bulk add
  dropZone: { display:"block", cursor:"pointer", marginBottom:24, border:"2px dashed var(--color-border-muted)", borderRadius:10 },
  dropInner: { padding:"32px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:8 },
  dropIcon: { fontSize:26, color:"var(--color-accent)" },
  dropTitle: { fontSize:15, color:"var(--color-ink)", letterSpacing:"0.06em" },
  dropSub: { fontSize:12, color:"var(--color-text-muted)", textAlign:"center" },
  queueBadge: { marginLeft:"auto", background:"var(--color-ink)", color:"var(--color-surface)", borderRadius:12, padding:"2px 10px", fontSize:11, fontFamily:"sans-serif" },
  queueList: { display:"flex", flexDirection:"column", gap:14, marginBottom:20 },
  queueRow: { display:"flex", gap:10, alignItems:"flex-start", background:"#fff", borderRadius:8, padding:12, border:"1px solid var(--color-border)" },
  queueThumb: { flexShrink:0, width:76, height:95, borderRadius:5, overflow:"hidden", background:"var(--color-surface)", position:"relative" },
  queueThumbImg: { width:"100%", height:"100%", objectFit:"cover" },
  queueFields: { flex:1, display:"flex", flexDirection:"column", gap:6 },
  queueInput: { width:"100%", boxSizing:"border-box", fontSize:12, padding:"6px 8px" },
  queueRow2: { display:"flex", gap:6 },
  queueSelect: { flex:"0 0 46%", fontSize:12, padding:"6px 8px" },
  queueRemove: { flexShrink:0, background:"none", border:"none", color:"var(--color-border-muted)", fontSize:15, cursor:"pointer", padding:"0 4px", alignSelf:"flex-start" },
  queueActions: { display:"flex", flexDirection:"column", gap:10 },

  // Edit
  fieldLabel: { fontSize:11, letterSpacing:"0.14em", color:"var(--color-text-2)", marginBottom:5 },

  // Settings
  settingsCard: { background:"#fff", borderRadius:8, border:"1px solid var(--color-border)", padding:20, marginBottom:16 },
  settingsTitle: { fontSize:14, letterSpacing:"0.06em", marginBottom:10, display:"flex", alignItems:"center", gap:7 },
  settingsSub: { fontSize:12, color:"var(--color-text-muted)", lineHeight:1.6 },
  showHideBtn: { position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"var(--color-text-muted)", fontSize:11 },

  // Remove.bg
  rmbgNotice: { background:"#EFF7F1", border:"1px solid #B8D9C0", borderRadius:6, padding:"10px 14px", fontSize:12, color:"var(--color-success)", marginBottom:16, letterSpacing:"0.03em" },
  thumbOverlay: { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(28,24,20,0.45)" },

  // ── Look card
  lookCard: { background:"#fff", borderRadius:12, border:"1px solid var(--color-border)", marginBottom:28, overflow:"hidden", boxShadow:"0 4px 24px rgba(28,24,20,0.07)", animation:"fadeIn 0.35s ease" },
  lookHeader: { padding:"18px 22px 14px", borderBottom:"1px solid var(--color-border-soft)", display:"flex", justifyContent:"space-between", alignItems:"center" },
  lookName: { fontSize:20, fontWeight:400, letterSpacing:"0.04em", marginBottom:3, fontFamily:"'DM Serif Display',Georgia,serif" },
  lookOcc:  { fontSize:9, letterSpacing:"0.2em", color:"var(--color-text-muted)" },
  lookMood: { color:"var(--color-accent)" },
  expandBtn: { background:"none", border:"1px solid #DDD5CC", borderRadius:20, padding:"4px 13px", fontSize:11, color:"var(--color-text-2)", cursor:"pointer", letterSpacing:"0.06em" },

  // ── Editorial collage canvas
  collageCanvas: { position:"relative", width:"100%", paddingBottom:"74%", background:"transparent", overflow:"hidden", margin:"0" },
  collagePh: { width:"100%", height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, padding:8, background:"var(--color-surface-3)" },
  collageCat:  { fontSize:10, color:"var(--color-border-muted)", letterSpacing:"0.1em" },
  collageName: { fontSize:9, color:"var(--color-text-muted)", textAlign:"center", lineHeight:1.4 },

  // Teaser + meta
  lookTeaser: { padding:"11px 22px 13px", borderTop:"1px solid var(--color-border-soft)", fontSize:12, color:"#8B6E4E", display:"flex", alignItems:"center", gap:7 },
  teaserDiamond: { color:"var(--color-accent)", fontSize:14 },
  lookMeta: { padding:"14px 22px 18px", display:"flex", flexDirection:"column", gap:8, borderTop:"1px solid var(--color-border-soft)" },
  metaRow: { fontSize:12, color:"var(--color-text)", lineHeight:1.6, display:"flex", gap:8, alignItems:"flex-start" },
  metaIcon: { flexShrink:0, color:"var(--color-accent)", marginTop:1 },

  // ── Color Advisor
  modeTabs: { display:"flex", gap:4, marginBottom:24, background:"#fff", border:"1px solid var(--color-border)", borderRadius:8, padding:4 },
  modeTab: { flex:1, background:"none", border:"none", borderRadius:6, padding:"8px 10px", fontSize:11, letterSpacing:"0.08em", color:"var(--color-text-2)", cursor:"pointer" },
  modeTabActive: { background:"var(--color-ink)", color:"var(--color-surface)" },
  advisorNote: { background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:6, padding:"10px 14px", fontSize:12, color:"var(--color-text-2)", lineHeight:1.6, marginBottom:16 },
  colorResult: { background:"#fff", border:"1px solid var(--color-border)", borderRadius:8, padding:"16px 18px", marginBottom:16, animation:"fadeIn 0.3s ease" },
  colorVerdict: { fontSize:15, fontWeight:500, marginBottom:10, fontFamily:"'DM Serif Display',Georgia,serif" },
  colorMeta: { display:"flex", gap:8, marginBottom:10 },
  colorTag: { background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:12, padding:"3px 10px", fontSize:10, letterSpacing:"0.08em", color:"var(--color-text-2)" },
  colorDesc: { fontSize:12, color:"var(--color-text)", fontStyle:"italic", marginBottom:8 },
  colorReasoning: { fontSize:12, color:"var(--color-text-2)", lineHeight:1.6 },
  colorException: { marginTop:10, background:"#FFF8EC", border:"1px solid #E8D5A0", borderRadius:4, padding:"8px 12px", fontSize:11, color:"#8B6914", lineHeight:1.5 },
  pairingSection: { background:"#fff", border:"1px solid var(--color-border)", borderRadius:8, padding:"14px 16px", marginBottom:16 },
  pairingLabel: { fontSize:11, letterSpacing:"0.1em", color:"var(--color-text-2)", marginBottom:12 },
  pairingRow: { display:"flex", gap:10, overflowX:"auto", paddingBottom:4 },
  pairingItem: { flexShrink:0, width:72, display:"flex", flexDirection:"column", alignItems:"center", gap:6 },
  pairingThumb: { width:64, height:80, objectFit:"contain", borderRadius:4, border:"1px solid var(--color-border)" },
  pairingName: { fontSize:9, color:"var(--color-text-muted)", textAlign:"center", lineHeight:1.3 },
  auditProgressWrap: { marginBottom:20 },
  auditProgressTrack: { height:4, background:"var(--color-border)", borderRadius:2, marginBottom:8, overflow:"hidden" },
  auditProgressBar: { height:"100%", background:"var(--color-ink)", borderRadius:2, transition:"width 0.3s ease" },
  auditProgressText: { fontSize:11, color:"var(--color-text-muted)", letterSpacing:"0.06em" },
  auditGroup: { marginBottom:20 },
  auditGroupHeader: { fontSize:11, letterSpacing:"0.12em", color:"var(--color-text-2)", marginBottom:10, paddingBottom:8, borderBottom:"1px solid var(--color-border)", display:"flex", alignItems:"center", gap:6 },
  auditCount: { color:"var(--color-text-muted)", fontWeight:400 },
  auditRow: { display:"flex", gap:12, alignItems:"flex-start", padding:"10px 0", borderBottom:"1px solid var(--color-surface)" },
  auditThumb: { flexShrink:0, width:52, height:64, objectFit:"contain", borderRadius:4, border:"1px solid var(--color-border)" },
  auditInfo: { flex:1, minWidth:0 },
  auditName: { fontSize:13, marginBottom:2 },
  auditCat: { fontSize:9, letterSpacing:"0.12em", color:"var(--color-text-muted)", marginBottom:4 },
  auditColorDesc: { fontSize:11, color:"var(--color-text)", fontStyle:"italic", marginBottom:3 },
  auditReasoning: { fontSize:11, color:"var(--color-text-2)", lineHeight:1.5 },
  keepAnywayBtn: { flexShrink:0, alignSelf:"center", background:"none", border:"1px solid var(--color-border-muted)", borderRadius:4, padding:"5px 10px", fontSize:10, color:"var(--color-text-muted)", cursor:"pointer", letterSpacing:"0.06em" },

  // ── Sets
  setBadge: { position:"absolute", top:6, left:6, background:"rgba(28,24,20,0.75)", color:"var(--color-surface)", fontSize:8, letterSpacing:"0.1em", padding:"3px 7px", borderRadius:3, border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  setPanel: { background:"#fff", border:"1px solid var(--color-border)", borderRadius:8, margin:"0 0 10px", padding:"12px 14px", animation:"fadeIn 0.2s ease" },
  setPanelHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 },
  setPanelTitle: { fontSize:10, letterSpacing:"0.18em", color:"var(--color-text-2)" },
  setPanelClose: { background:"none", border:"none", color:"var(--color-border-muted)", fontSize:13, cursor:"pointer", padding:0 },
  setPanelItems: { display:"flex", gap:10, overflowX:"auto" },
  setPanelItem: { flexShrink:0, width:70, display:"flex", flexDirection:"column", alignItems:"center", gap:5 },
  setPanelThumb: { width:64, height:80, objectFit:"contain", borderRadius:4, border:"1px solid var(--color-border)" },
  setPanelName: { fontSize:9, color:"var(--color-text)", textAlign:"center", lineHeight:1.3 },
  setPanelCat: { fontSize:8, color:"var(--color-text-muted)", letterSpacing:"0.08em" },
  setGroup: { marginBottom:24 },
  setGroupLabel: { fontSize:10, letterSpacing:"0.2em", color:"var(--color-text-muted)", marginBottom:12, paddingBottom:8, borderBottom:"1px solid var(--color-border)" },

  // ── Filter bar
  filterBar: { marginBottom:20 },
  filterSection: { marginBottom:12 },
  filterSectionLabel: { fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", marginBottom:6 },
  filterRow: { display:"flex", gap:6, flexWrap:"wrap" },
  swatchBtn: { width:22, height:22, borderRadius:"50%", cursor:"pointer", flexShrink:0, transition:"box-shadow 0.15s" },
  shadePopover: { position:"absolute", top:28, left:0, background:"#fff", border:"1px solid var(--color-border)", borderRadius:8, padding:8, display:"flex", gap:6, zIndex:20, boxShadow:"0 4px 16px rgba(0,0,0,0.12)" },
  shadeSwatch: { width:20, height:20, borderRadius:"50%", cursor:"pointer", transition:"box-shadow 0.15s" },
  filterToggleBtn: { background:"none", border:"1px solid var(--color-border)", borderRadius:16, padding:"4px 12px", fontSize:11, color:"var(--color-text-2)", cursor:"pointer", letterSpacing:"0.06em" },
  brandPanel: { marginTop:8, background:"#fff", border:"1px solid var(--color-border)", borderRadius:8, padding:12 },
  activePills: { display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:4 },
  activePill: { background:"var(--color-ink)", color:"var(--color-surface)", border:"none", borderRadius:12, padding:"3px 10px", fontSize:10, cursor:"pointer", letterSpacing:"0.04em" },
  clearAllBtn: { background:"none", border:"none", color:"var(--color-text-muted)", fontSize:10, cursor:"pointer", letterSpacing:"0.06em", textDecoration:"underline" },

  // ── Knit prompt
  knitPrompt: { background:"var(--color-surface)", border:"1px solid var(--color-border)", borderRadius:6, padding:"10px 12px", fontSize:12, color:"var(--color-text)", marginTop:4 },
  knitSugText: { lineHeight:1.5 },
  knitConfirm: { background:"var(--color-ink)", color:"var(--color-surface)", border:"none", borderRadius:4, padding:"5px 12px", fontSize:11, cursor:"pointer", letterSpacing:"0.06em" },
  knitEdit:    { background:"none", border:"1px solid var(--color-border-muted)", borderRadius:4, padding:"5px 12px", fontSize:11, color:"var(--color-text-2)", cursor:"pointer", letterSpacing:"0.06em" },

  // ── Save button
  saveBar: { padding:"12px 18px 14px", borderTop:"1px solid var(--color-border-soft)", display:"flex" },
  saveBtn: { flex:1, background:"var(--color-success)", color:"#fff", border:"none", borderRadius:4, padding:"10px 16px", fontSize:11, letterSpacing:"0.1em", cursor:"pointer", fontFamily:"Georgia,serif" },

  // ── Heart button
  heartBtn: { background:"none", border:"none", cursor:"pointer", padding:4, display:"flex", alignItems:"center" },

  // ── Modal
  modalOverlay: { position:"fixed", inset:0, background:"rgba(28,24,20,0.5)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:20 },
  modalCard: { background:"#fff", borderRadius:12, width:"100%", maxWidth:400, maxHeight:"80vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" },
  modalHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"18px 22px 12px", borderBottom:"1px solid var(--color-border-soft)" },
  modalTitle: { fontSize:16, letterSpacing:"0.04em" },
  modalClose: { background:"none", border:"none", fontSize:24, color:"var(--color-text-muted)", cursor:"pointer", padding:0, lineHeight:1 },
  modalLookPreview: { padding:"14px 22px", background:"var(--color-surface-2)", borderBottom:"1px solid var(--color-border-soft)" },
  modalLookName: { fontSize:15, fontWeight:400, letterSpacing:"0.04em", marginBottom:4 },
  modalLookPieces: { fontSize:11, color:"var(--color-text-muted)" },
  modalField: { padding:"10px 22px 0" },
  modalLabel: { fontSize:9, letterSpacing:"0.18em", color:"var(--color-text-muted)", display:"block", marginBottom:5, fontFamily:"sans-serif" },
  modalInput: { width:"100%", border:"1px solid var(--color-border)", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"var(--color-ink)", boxSizing:"border-box" },
  modalSaveBtn: { margin:"16px 22px 22px", width:"calc(100% - 44px)", background:"var(--color-ink)", color:"var(--color-surface)", border:"none", borderRadius:4, padding:"11px 20px", fontSize:12, letterSpacing:"0.08em", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 },

  // ── Outfit History
  histMonthLabel: { fontSize:11, letterSpacing:"0.2em", color:"var(--color-text-muted)", padding:"0 0 10px", marginBottom:0, borderBottom:"1px solid var(--color-border)", fontFamily:"sans-serif" },
  histCard: { background:"#fff", borderRadius:10, border:"1px solid var(--color-border)", padding:0, marginTop:12, overflow:"hidden", boxShadow:"0 2px 12px rgba(28,24,20,0.04)" },
  histCardHeader: { padding:"14px 18px 10px" },
  histLookName: { fontSize:16, fontWeight:400, letterSpacing:"0.04em", marginBottom:3 },
  histDate: { fontSize:11, color:"var(--color-text-muted)", letterSpacing:"0.04em" },
  histOcc: { color:"var(--color-text-2)" },
  histMood: { color:"var(--color-accent)", fontStyle:"italic" },
  histThumbs: { display:"flex", gap:10, padding:"0 18px 12px", overflowX:"auto" },
  histThumb: { flexShrink:0, width:56, textAlign:"center" },
  histThumbImg: { width:56, height:68, objectFit:"contain", borderRadius:6, background:"var(--color-surface)" },
  histThumbPh: { width:56, height:68, borderRadius:6, background:"var(--color-surface)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"var(--color-border-muted)" },
  histThumbName: { fontSize:9, color:"var(--color-text-muted)", marginTop:3, lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  histNotes: { padding:"0 18px 12px", fontSize:12, color:"var(--color-text-2)", fontStyle:"italic" },
  histActions: { padding:"8px 18px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", borderTop:"1px solid var(--color-border-soft)" },
  histWearBtn: { background:"none", border:"1px solid var(--color-border)", borderRadius:4, padding:"5px 12px", fontSize:11, color:"var(--color-text-2)", cursor:"pointer", letterSpacing:"0.04em", display:"flex", alignItems:"center", gap:5 },
  histDeleteBtn: { background:"none", border:"none", fontSize:11, color:"var(--color-text-muted)", cursor:"pointer", padding:"4px 8px" },
};

// ── STYLE INSIGHTS STYLES ────────────────────────────────────────────────────
export const si = {
  card: { background:"#fff", borderRadius:10, border:"1px solid var(--color-border)", padding:"22px 24px", marginBottom:20, position:"relative", animation:"fadeIn 0.35s ease" },
  profileCard: { background:"linear-gradient(135deg, var(--color-ink) 0%, #2A2420 100%)", borderRadius:12, padding:"26px 26px 22px", marginBottom:20, position:"relative", color:"var(--color-surface)", animation:"fadeIn 0.4s ease" },
  cardDismiss: { position:"absolute", top:12, right:14, cursor:"pointer", color:"var(--color-text-muted)", fontSize:14, lineHeight:1, padding:4, opacity:0.5 },
  sectionLabel: { fontSize:9, letterSpacing:"0.22em", color:"var(--color-text-muted)", marginBottom:14, fontFamily:"sans-serif" },
  sectionHeader: { fontSize:18, fontFamily:"'DM Serif Display',Georgia,serif", fontWeight:400, letterSpacing:"0.02em", marginBottom:16, color:"var(--color-ink)" },
  profileText: { fontSize:15, lineHeight:1.7, fontStyle:"italic", color:"var(--color-border)", marginBottom:16, fontFamily:"Georgia,serif" },
  profilePlaceholder: { fontSize:13, color:"var(--color-text-2)", lineHeight:1.6, marginBottom:16 },
  profileBtn: { background:"none", border:"1.5px solid rgba(196,168,130,0.5)", borderRadius:4, padding:"9px 18px", fontSize:11, letterSpacing:"0.12em", color:"var(--color-accent)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7, fontFamily:"Georgia,serif", width:"100%" },
  divider: { height:1, background:"var(--color-border-soft)", margin:"16px 0" },
  insightRow: { display:"flex", gap:12, alignItems:"center", padding:"8px 0", borderBottom:"1px solid #F8F5F0" },
  insightText: { fontSize:13, color:"var(--color-text)", lineHeight:1.5, flex:1 },
  swatchPair: { display:"flex", gap:3, flexShrink:0 },
  swatchDot: { width:14, height:14, borderRadius:"50%", border:"1px solid rgba(0,0,0,0.08)", display:"inline-block" },
  anchorThumb: { width:36, height:36, borderRadius:6, overflow:"hidden", background:"var(--color-surface)", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" },
  anchorImg: { width:"100%", height:"100%", objectFit:"contain" },
  barContainer: { display:"flex", flexDirection:"column", gap:6 },
  barRow: { display:"flex", alignItems:"center", gap:10 },
  barLabel: { width:90, fontSize:11, color:"var(--color-text-2)", textAlign:"right", flexShrink:0 },
  barTrack: { flex:1, height:6, background:"var(--color-surface-3)", borderRadius:3, overflow:"hidden" },
  barFill: { height:"100%", background:"var(--color-ink)", borderRadius:3, transition:"width 0.6s ease" },
  barCount: { width:24, fontSize:11, color:"var(--color-text-muted)", textAlign:"right" },
  gapAlert: { fontSize:13, color:"#8B6914", lineHeight:1.6, padding:"10px 14px", background:"#FFF8EC", borderRadius:6, border:"1px solid #E8D5A0", marginTop:8 },
  subtleNote: { fontSize:12, color:"var(--color-text-muted)", lineHeight:1.5, marginBottom:14, marginTop:0 },
  underutilGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 },
  underutilCard: { background:"var(--color-surface-2)", borderRadius:8, border:"1px solid var(--color-border-soft)", overflow:"hidden" },
  underutilImg: { height:100, background:"var(--color-surface)", display:"flex", alignItems:"center", justifyContent:"center" },
  underutilMeta: { padding:"8px 10px 10px" },
  pairGrid: { display:"flex", flexWrap:"wrap", gap:10 },
  pairChip: { display:"flex", alignItems:"center", gap:5, background:"var(--color-surface-2)", borderRadius:20, padding:"6px 14px", border:"1px solid var(--color-border-soft)" },
};

// ── SETS STYLES ──────────────────────────────────────────────────────────────
export const ss = {
  filterBar: { marginBottom: 16 },
  searchRow: { display: "flex", gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, border: "1px solid var(--color-border)", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "var(--color-ink)", background: "#fff", outline: "none", fontFamily: "'DM Sans',sans-serif" },
  sortSelect: { border: "1px solid var(--color-border)", borderRadius: 6, padding: "8px 10px", fontSize: 11, color: "var(--color-text-2)", background: "#fff", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: "0.04em" },
  tagRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  countLabel: { fontSize: 10, letterSpacing: "0.18em", color: "var(--color-text-muted)", marginBottom: 12, fontFamily: "sans-serif" },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 },
  card: { background: "#fff", borderRadius: 10, border: "1px solid var(--color-border)", overflow: "hidden", cursor: "pointer", transition: "box-shadow 0.2s ease" },
  collage: { width: "100%", aspectRatio: "1", background: "var(--color-surface)", display: "flex", flexWrap: "wrap", overflow: "hidden" },
  collageTile: { overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid var(--color-surface-3)", borderBottom: "1px solid var(--color-surface-3)", boxSizing: "border-box" },
  collageImg: { width: "100%", height: "100%", objectFit: "contain", background: "var(--color-surface-2)" },
  collagePlaceholder: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "var(--color-border-muted)", background: "var(--color-surface)" },
  cardBody: { padding: "10px 12px 12px" },
  cardName: { fontSize: 14, fontWeight: 500, color: "var(--color-ink)", letterSpacing: "0.02em", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'DM Sans',sans-serif" },
  cardCount: { fontSize: 10, color: "var(--color-text-muted)", letterSpacing: "0.08em", marginBottom: 6 },
  cardTags: { display: "flex", gap: 4, flexWrap: "wrap" },
  tagChip: { fontSize: 9, letterSpacing: "0.06em", color: "var(--color-text-2)", background: "var(--color-surface)", borderRadius: 10, padding: "2px 8px" },
  modalItem: { display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", background: "var(--color-surface-2)", borderRadius: 6, cursor: "pointer", border: "1px solid var(--color-border-soft)" },
  modalItemThumb: { width: 40, height: 50, objectFit: "contain", borderRadius: 4, flexShrink: 0, border: "1px solid var(--color-border)" },
};
