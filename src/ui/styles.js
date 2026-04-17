// ── ATELIER STYLES ───────────────────────────────────────────────────────────
// Shared inline style objects used across the feature components. Split into
// three groups for historical reasons: `s` is the general palette, `si` are
// insights-specific, `ss` are sets-specific. Components that only use a
// handful can cherry-pick.

export const s = {
  app: { minHeight:"100vh", background:"#F5F1EC", fontFamily:"'DM Sans',system-ui,sans-serif", color:"#1C1814" },

  // Header
  header: { background:"#1C1814", position:"sticky", top:0, zIndex:100, borderBottom:"1px solid #2e2622" },
  headerInner: { maxWidth:900, margin:"0 auto", padding:"0 20px", height:56, display:"flex", alignItems:"center", justifyContent:"space-between" },
  brand: { display:"flex", alignItems:"center", gap:8 },
  brandMark: { color:"#C4A882", fontSize:16 },
  brandName: { color:"#F5F1EC", fontSize:13, letterSpacing:"0.25em", fontFamily:"'DM Sans',sans-serif" },
  savedPill: { background:"#3D7A4E", color:"#fff", borderRadius:10, padding:"2px 8px", fontSize:10, fontFamily:"sans-serif" },
  nav: { display:"flex", gap:4, alignItems:"center" },
  navBtn: { background:"none", border:"none", color:"#9A8E84", fontSize:12, letterSpacing:"0.12em", padding:"6px 12px", cursor:"pointer", borderRadius:3, display:"flex", alignItems:"center", gap:5 },
  navActive: { color:"#F5F1EC" },
  badge: { background:"#C4A882", color:"#1C1814", borderRadius:10, padding:"1px 6px", fontSize:10, fontFamily:"sans-serif" },

  // Page
  page: { maxWidth:900, margin:"0 auto", padding:"24px 20px 160px", position:"relative" },
  pageHeader: { display:"flex", alignItems:"center", gap:14, marginBottom:24 },
  pageTitle: { fontSize:20, fontWeight:400, letterSpacing:"0.05em", margin:0 },
  backBtn: { background:"none", border:"none", color:"#6B5E54", fontSize:13, cursor:"pointer", padding:0 },

  // Filter (legacy — kept for queue rows etc.)
  chipRow: { display:"flex", gap:8, flexWrap:"wrap", marginBottom:24 },
  chip: { background:"none", border:"1px solid #C8BFB4", color:"#6B5E54", fontSize:11, letterSpacing:"0.08em", padding:"5px 13px", borderRadius:20, cursor:"pointer", transition:"all 0.15s ease" },
  chipActive: { background:"#1C1814", borderColor:"#1C1814", color:"#F5F1EC", fontWeight:500, boxShadow:"0 2px 8px rgba(28,24,20,0.25)" },

  // Grid
  grid: { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:14 },

  // Card
  card: { background:"#fff", borderRadius:8, overflow:"hidden", border:"1px solid #E8E0D8", position:"relative" },
  cardImg: { height:190, background:"#F5F1EC", overflow:"hidden", cursor:"pointer" },
  cardPhoto: { width:"100%", height:"100%", objectFit:"contain" },
  cardPlaceholder: { width:"100%", height:"100%", display:"flex", alignItems:"center", justifyContent:"center", fontSize:34, color:"#C8BFB4", fontFamily:"sans-serif" },
  cardBody: { padding:"10px 12px 10px" },
  cardCat: { fontSize:9, letterSpacing:"0.15em", color:"#9A8E84", marginBottom:3 },
  cardName: { fontSize:13, lineHeight:1.3, marginBottom:3 },
  cardColor: { fontSize:11, color:"#6B5E54" },
  cardNotes: { fontSize:10, color:"#9A8E84", fontStyle:"italic", marginTop:2 },
  cardActions: { display:"flex", gap:4, padding:"0 8px 8px", justifyContent:"flex-end" },
  iconBtn: { background:"none", border:"none", cursor:"pointer", color:"#C8BFB4", padding:4, display:"flex", alignItems:"center" },

  // Empty
  empty: { display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"80px 20px", gap:16 },
  emptyMark: { fontSize:36, color:"#C8BFB4" },
  emptyText: { color:"#9A8E84", fontSize:14, textAlign:"center" },

  // Spinners
  spinner: { display:"inline-block", width:28, height:28, border:"2px solid #E8E0D8", borderTop:"2px solid #1C1814", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  spinnerSm: { display:"inline-block", width:13, height:13, border:"2px solid rgba(255,255,255,0.3)", borderTop:"2px solid #fff", borderRadius:"50%", animation:"spin 0.8s linear infinite" },
  spinnerElevate: { display:"inline-block", width:11, height:11, border:"1.5px solid #C8BFB4", borderTop:"1.5px solid #1C1814", borderRadius:"50%", animation:"spin 0.8s linear infinite" },

  // Style panel
  stylePanel: { position:"fixed", bottom:0, left:0, right:0, background:"#fff", borderTop:"1px solid #E8E0D8", padding:"14px 20px", zIndex:50, boxShadow:"0 -4px 20px rgba(0,0,0,0.08)", maxHeight:"80vh", overflowY:"auto" },
  panelLabel: { fontSize:10, letterSpacing:"0.22em", color:"#9A8E84", marginBottom:10 },
  panelRow: { display:"flex", gap:8, marginBottom:8 },
  select: { flex:1, border:"1px solid #E8E0D8", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"#1C1814" },
  input: { flex:1, border:"1px solid #E8E0D8", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"#1C1814", outline:"none" },
  err: { color:"#C0392B", fontSize:12, margin:"4px 0 0" },
  btnPrimary: { background:"#1C1814", color:"#F5F1EC", border:"none", borderRadius:4, padding:"10px 20px", fontSize:12, letterSpacing:"0.08em", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 },
  btnSecondary: { background:"none", border:"1px solid #E8E0D8", borderRadius:4, padding:"10px 20px", fontSize:12, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.06em", textAlign:"center" },
  fab: { position:"fixed", bottom:200, right:20, width:48, height:48, borderRadius:24, background:"#1C1814", color:"#F5F1EC", border:"none", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", boxShadow:"0 4px 16px rgba(0,0,0,0.22)", zIndex:60 },

  // Bulk add
  dropZone: { display:"block", cursor:"pointer", marginBottom:24, border:"2px dashed #C8BFB4", borderRadius:10 },
  dropInner: { padding:"32px 20px", display:"flex", flexDirection:"column", alignItems:"center", gap:8 },
  dropIcon: { fontSize:26, color:"#C4A882" },
  dropTitle: { fontSize:15, color:"#1C1814", letterSpacing:"0.06em" },
  dropSub: { fontSize:12, color:"#9A8E84", textAlign:"center" },
  queueBadge: { marginLeft:"auto", background:"#1C1814", color:"#F5F1EC", borderRadius:12, padding:"2px 10px", fontSize:11, fontFamily:"sans-serif" },
  queueList: { display:"flex", flexDirection:"column", gap:14, marginBottom:20 },
  queueRow: { display:"flex", gap:10, alignItems:"flex-start", background:"#fff", borderRadius:8, padding:12, border:"1px solid #E8E0D8" },
  queueThumb: { flexShrink:0, width:76, height:95, borderRadius:5, overflow:"hidden", background:"#F5F1EC", position:"relative" },
  queueThumbImg: { width:"100%", height:"100%", objectFit:"cover" },
  queueFields: { flex:1, display:"flex", flexDirection:"column", gap:6 },
  queueInput: { width:"100%", boxSizing:"border-box", fontSize:12, padding:"6px 8px" },
  queueRow2: { display:"flex", gap:6 },
  queueSelect: { flex:"0 0 46%", fontSize:12, padding:"6px 8px" },
  queueRemove: { flexShrink:0, background:"none", border:"none", color:"#C8BFB4", fontSize:15, cursor:"pointer", padding:"0 4px", alignSelf:"flex-start" },
  queueActions: { display:"flex", flexDirection:"column", gap:10 },

  // Edit
  fieldLabel: { fontSize:11, letterSpacing:"0.14em", color:"#6B5E54", marginBottom:5 },

  // Settings
  settingsCard: { background:"#fff", borderRadius:8, border:"1px solid #E8E0D8", padding:20, marginBottom:16 },
  settingsTitle: { fontSize:14, letterSpacing:"0.06em", marginBottom:10, display:"flex", alignItems:"center", gap:7 },
  settingsSub: { fontSize:12, color:"#9A8E84", lineHeight:1.6 },
  showHideBtn: { position:"absolute", right:8, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", color:"#9A8E84", fontSize:11 },

  // Remove.bg
  rmbgNotice: { background:"#EFF7F1", border:"1px solid #B8D9C0", borderRadius:6, padding:"10px 14px", fontSize:12, color:"#3D7A4E", marginBottom:16, letterSpacing:"0.03em" },
  thumbOverlay: { position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", background:"rgba(28,24,20,0.45)" },

  // ── Look card
  lookCard: { background:"#fff", borderRadius:12, border:"1px solid #E8E0D8", marginBottom:28, overflow:"hidden", boxShadow:"0 4px 24px rgba(28,24,20,0.07)", animation:"fadeIn 0.35s ease" },
  lookHeader: { padding:"18px 22px 14px", borderBottom:"1px solid #F0E8E0", display:"flex", justifyContent:"space-between", alignItems:"center" },
  lookName: { fontSize:20, fontWeight:400, letterSpacing:"0.04em", marginBottom:3, fontFamily:"'DM Serif Display',Georgia,serif" },
  lookOcc:  { fontSize:9, letterSpacing:"0.2em", color:"#9A8E84" },
  lookMood: { color:"#C4A882" },
  expandBtn: { background:"none", border:"1px solid #DDD5CC", borderRadius:20, padding:"4px 13px", fontSize:11, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.06em" },

  // ── Editorial collage canvas
  collageCanvas: { position:"relative", width:"100%", paddingBottom:"95%", background:"#FFFFFF", overflow:"hidden", margin:"0" },
  collagePh: { width:"100%", height:"100%", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, padding:8, background:"#F0EBE4" },
  collageCat:  { fontSize:10, color:"#C8BFB4", letterSpacing:"0.1em" },
  collageName: { fontSize:9, color:"#9A8E84", textAlign:"center", lineHeight:1.4 },

  // Teaser + meta
  lookTeaser: { padding:"11px 22px 13px", borderTop:"1px solid #F0E8E0", fontSize:12, color:"#8B6E4E", display:"flex", alignItems:"center", gap:7 },
  teaserDiamond: { color:"#C4A882", fontSize:14 },
  lookMeta: { padding:"14px 22px 18px", display:"flex", flexDirection:"column", gap:8, borderTop:"1px solid #F0E8E0" },
  metaRow: { fontSize:12, color:"#4A3E36", lineHeight:1.6, display:"flex", gap:8, alignItems:"flex-start" },
  metaIcon: { flexShrink:0, color:"#C4A882", marginTop:1 },

  // ── Elevate feature
  elevateBar: { padding:"12px 18px 14px", borderTop:"1px solid #F0E8E0" },
  elevateBtn: { width:"100%", background:"none", border:"1.5px solid #1C1814", borderRadius:4, padding:"10px 16px", fontSize:11, letterSpacing:"0.14em", color:"#1C1814", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7, fontFamily:"'DM Sans',sans-serif", transition:"all 0.2s" },
  elevatedSection: { borderTop:"2px solid #1C1814" },
  elevDivider: { display:"flex", alignItems:"center", gap:10, padding:"14px 18px 10px" },
  elevDividerLine: { flex:1, height:1, background:"#E8E0D8" },
  elevDividerLabel: { fontSize:9, letterSpacing:"0.25em", color:"#9A8E84", fontFamily:"sans-serif" },
  elevHeader: { padding:"0 18px 14px" },
  elevName: { fontSize:18, fontWeight:400, letterSpacing:"0.04em", marginBottom:4 },
  elevWhy: { fontSize:12, color:"#6B5E54", fontStyle:"italic", lineHeight:1.5 },

  elevSlotPh: { width:"100%", height:"100%", minHeight:100, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:4, padding:10, background:"linear-gradient(135deg, #F5F1EC 0%, #EDE8E2 100%)", border:"1.5px dashed #C8BFB4", position:"relative" },
  elevSlotBrand: { fontSize:10, letterSpacing:"0.1em", color:"#6B5E54", fontWeight:600 },
  elevSlotItem:  { fontSize:9, color:"#9A8E84", textAlign:"center", lineHeight:1.4 },
  elevSlotPrice: { fontSize:10, color:"#C4A882", marginTop:2, letterSpacing:"0.06em" },
  elevSlotBadge: { position:"absolute", top:6, right:6, background:"#1C1814", color:"#F5F1EC", fontSize:7, letterSpacing:"0.1em", padding:"2px 5px", borderRadius:2, fontFamily:"sans-serif" },

  elevSuggestions: { display:"flex", flexDirection:"column", gap:10, padding:"0 16px 16px" },
  elevSuggestionCard: { background:"#FAFAF8", border:"1px solid #E8E0D8", borderRadius:8, padding:"12px 14px" },
  elevSugHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 },
  elevSugBadge: (type) => ({
    fontSize:9, letterSpacing:"0.12em",
    background: type==="swap" ? "#EDE8FF" : "#E8F5EC",
    color: type==="swap" ? "#5B4E8E" : "#3D7A4E",
    padding:"2px 7px", borderRadius:3,
    fontFamily:"sans-serif",
  }),
  elevSugPrice:  { fontSize:11, color:"#C4A882", letterSpacing:"0.04em" },
  elevSugItem:   { fontSize:14, fontWeight:400, letterSpacing:"0.03em", marginBottom:3 },
  elevSugDesc:   { fontSize:11, color:"#6B5E54", marginBottom:4, lineHeight:1.5 },
  elevSugSwap:   { fontSize:10, color:"#9A8E84", fontStyle:"italic", marginBottom:4 },
  elevSugWhy:    { fontSize:12, color:"#4A3E36", lineHeight:1.5, marginBottom:4 },
  elevSugColor:  { fontSize:10, color:"#3D7A4E", letterSpacing:"0.04em" },

  // ── Color Advisor
  modeTabs: { display:"flex", gap:4, marginBottom:24, background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:4 },
  modeTab: { flex:1, background:"none", border:"none", borderRadius:6, padding:"8px 10px", fontSize:11, letterSpacing:"0.08em", color:"#6B5E54", cursor:"pointer" },
  modeTabActive: { background:"#1C1814", color:"#F5F1EC" },
  advisorNote: { background:"#F5F1EC", border:"1px solid #E8E0D8", borderRadius:6, padding:"10px 14px", fontSize:12, color:"#6B5E54", lineHeight:1.6, marginBottom:16 },
  colorResult: { background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:"16px 18px", marginBottom:16, animation:"fadeIn 0.3s ease" },
  colorVerdict: { fontSize:15, fontWeight:500, marginBottom:10, fontFamily:"'DM Serif Display',Georgia,serif" },
  colorMeta: { display:"flex", gap:8, marginBottom:10 },
  colorTag: { background:"#F5F1EC", border:"1px solid #E8E0D8", borderRadius:12, padding:"3px 10px", fontSize:10, letterSpacing:"0.08em", color:"#6B5E54" },
  colorDesc: { fontSize:12, color:"#4A3E36", fontStyle:"italic", marginBottom:8 },
  colorReasoning: { fontSize:12, color:"#6B5E54", lineHeight:1.6 },
  colorException: { marginTop:10, background:"#FFF8EC", border:"1px solid #E8D5A0", borderRadius:4, padding:"8px 12px", fontSize:11, color:"#8B6914", lineHeight:1.5 },
  pairingSection: { background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:"14px 16px", marginBottom:16 },
  pairingLabel: { fontSize:11, letterSpacing:"0.1em", color:"#6B5E54", marginBottom:12 },
  pairingRow: { display:"flex", gap:10, overflowX:"auto", paddingBottom:4 },
  pairingItem: { flexShrink:0, width:72, display:"flex", flexDirection:"column", alignItems:"center", gap:6 },
  pairingThumb: { width:64, height:80, objectFit:"contain", borderRadius:4, border:"1px solid #E8E0D8" },
  pairingName: { fontSize:9, color:"#9A8E84", textAlign:"center", lineHeight:1.3 },
  auditProgressWrap: { marginBottom:20 },
  auditProgressTrack: { height:4, background:"#E8E0D8", borderRadius:2, marginBottom:8, overflow:"hidden" },
  auditProgressBar: { height:"100%", background:"#1C1814", borderRadius:2, transition:"width 0.3s ease" },
  auditProgressText: { fontSize:11, color:"#9A8E84", letterSpacing:"0.06em" },
  auditGroup: { marginBottom:20 },
  auditGroupHeader: { fontSize:11, letterSpacing:"0.12em", color:"#6B5E54", marginBottom:10, paddingBottom:8, borderBottom:"1px solid #E8E0D8", display:"flex", alignItems:"center", gap:6 },
  auditCount: { color:"#9A8E84", fontWeight:400 },
  auditRow: { display:"flex", gap:12, alignItems:"flex-start", padding:"10px 0", borderBottom:"1px solid #F5F1EC" },
  auditThumb: { flexShrink:0, width:52, height:64, objectFit:"contain", borderRadius:4, border:"1px solid #E8E0D8" },
  auditInfo: { flex:1, minWidth:0 },
  auditName: { fontSize:13, marginBottom:2 },
  auditCat: { fontSize:9, letterSpacing:"0.12em", color:"#9A8E84", marginBottom:4 },
  auditColorDesc: { fontSize:11, color:"#4A3E36", fontStyle:"italic", marginBottom:3 },
  auditReasoning: { fontSize:11, color:"#6B5E54", lineHeight:1.5 },
  keepAnywayBtn: { flexShrink:0, alignSelf:"center", background:"none", border:"1px solid #C8BFB4", borderRadius:4, padding:"5px 10px", fontSize:10, color:"#9A8E84", cursor:"pointer", letterSpacing:"0.06em" },

  // ── Sets
  setBadge: { position:"absolute", top:6, left:6, background:"rgba(28,24,20,0.75)", color:"#F5F1EC", fontSize:8, letterSpacing:"0.1em", padding:"3px 7px", borderRadius:3, border:"none", cursor:"pointer", fontFamily:"'DM Sans',sans-serif" },
  setPanel: { background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, margin:"0 0 10px", padding:"12px 14px", animation:"fadeIn 0.2s ease" },
  setPanelHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 },
  setPanelTitle: { fontSize:10, letterSpacing:"0.18em", color:"#6B5E54" },
  setPanelClose: { background:"none", border:"none", color:"#C8BFB4", fontSize:13, cursor:"pointer", padding:0 },
  setPanelItems: { display:"flex", gap:10, overflowX:"auto" },
  setPanelItem: { flexShrink:0, width:70, display:"flex", flexDirection:"column", alignItems:"center", gap:5 },
  setPanelThumb: { width:64, height:80, objectFit:"contain", borderRadius:4, border:"1px solid #E8E0D8" },
  setPanelName: { fontSize:9, color:"#4A3E36", textAlign:"center", lineHeight:1.3 },
  setPanelCat: { fontSize:8, color:"#9A8E84", letterSpacing:"0.08em" },
  setGroup: { marginBottom:24 },
  setGroupLabel: { fontSize:10, letterSpacing:"0.2em", color:"#9A8E84", marginBottom:12, paddingBottom:8, borderBottom:"1px solid #E8E0D8" },

  // ── Filter bar
  filterBar: { marginBottom:20 },
  filterSection: { marginBottom:12 },
  filterSectionLabel: { fontSize:9, letterSpacing:"0.18em", color:"#9A8E84", marginBottom:6 },
  filterRow: { display:"flex", gap:6, flexWrap:"wrap" },
  swatchBtn: { width:22, height:22, borderRadius:"50%", cursor:"pointer", flexShrink:0, transition:"box-shadow 0.15s" },
  shadePopover: { position:"absolute", top:28, left:0, background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:8, display:"flex", gap:6, zIndex:20, boxShadow:"0 4px 16px rgba(0,0,0,0.12)" },
  shadeSwatch: { width:20, height:20, borderRadius:"50%", cursor:"pointer", transition:"box-shadow 0.15s" },
  filterToggleBtn: { background:"none", border:"1px solid #E8E0D8", borderRadius:16, padding:"4px 12px", fontSize:11, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.06em" },
  brandPanel: { marginTop:8, background:"#fff", border:"1px solid #E8E0D8", borderRadius:8, padding:12 },
  activePills: { display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginTop:4 },
  activePill: { background:"#1C1814", color:"#F5F1EC", border:"none", borderRadius:12, padding:"3px 10px", fontSize:10, cursor:"pointer", letterSpacing:"0.04em" },
  clearAllBtn: { background:"none", border:"none", color:"#9A8E84", fontSize:10, cursor:"pointer", letterSpacing:"0.06em", textDecoration:"underline" },

  // ── Knit prompt
  knitPrompt: { background:"#F5F1EC", border:"1px solid #E8E0D8", borderRadius:6, padding:"10px 12px", fontSize:12, color:"#4A3E36", marginTop:4 },
  knitSugText: { lineHeight:1.5 },
  knitConfirm: { background:"#1C1814", color:"#F5F1EC", border:"none", borderRadius:4, padding:"5px 12px", fontSize:11, cursor:"pointer", letterSpacing:"0.06em" },
  knitEdit:    { background:"none", border:"1px solid #C8BFB4", borderRadius:4, padding:"5px 12px", fontSize:11, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.06em" },

  // ── Save button
  saveBtn: { background:"#3D7A4E", color:"#fff", border:"none", borderRadius:4, padding:"10px 16px", fontSize:11, letterSpacing:"0.1em", cursor:"pointer", fontFamily:"Georgia,serif" },

  // ── Heart button
  heartBtn: { background:"none", border:"none", cursor:"pointer", padding:4, display:"flex", alignItems:"center" },

  // ── Modal
  modalOverlay: { position:"fixed", inset:0, background:"rgba(28,24,20,0.5)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:20 },
  modalCard: { background:"#fff", borderRadius:12, width:"100%", maxWidth:400, maxHeight:"80vh", overflow:"auto", boxShadow:"0 20px 60px rgba(0,0,0,0.3)" },
  modalHeader: { display:"flex", justifyContent:"space-between", alignItems:"center", padding:"18px 22px 12px", borderBottom:"1px solid #F0E8E0" },
  modalTitle: { fontSize:16, letterSpacing:"0.04em" },
  modalClose: { background:"none", border:"none", fontSize:24, color:"#9A8E84", cursor:"pointer", padding:0, lineHeight:1 },
  modalLookPreview: { padding:"14px 22px", background:"#FAFAF8", borderBottom:"1px solid #F0E8E0" },
  modalLookName: { fontSize:15, fontWeight:400, letterSpacing:"0.04em", marginBottom:4 },
  modalLookPieces: { fontSize:11, color:"#9A8E84" },
  modalField: { padding:"10px 22px 0" },
  modalLabel: { fontSize:9, letterSpacing:"0.18em", color:"#9A8E84", display:"block", marginBottom:5, fontFamily:"sans-serif" },
  modalInput: { width:"100%", border:"1px solid #E8E0D8", borderRadius:4, padding:"8px 10px", fontSize:13, background:"#fff", color:"#1C1814", boxSizing:"border-box" },
  modalSaveBtn: { margin:"16px 22px 22px", width:"calc(100% - 44px)", background:"#1C1814", color:"#F5F1EC", border:"none", borderRadius:4, padding:"11px 20px", fontSize:12, letterSpacing:"0.08em", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7 },

  // ── Outfit History
  histMonthLabel: { fontSize:11, letterSpacing:"0.2em", color:"#9A8E84", padding:"0 0 10px", marginBottom:0, borderBottom:"1px solid #E8E0D8", fontFamily:"sans-serif" },
  histCard: { background:"#fff", borderRadius:10, border:"1px solid #E8E0D8", padding:0, marginTop:12, overflow:"hidden", boxShadow:"0 2px 12px rgba(28,24,20,0.04)" },
  histCardHeader: { padding:"14px 18px 10px" },
  histLookName: { fontSize:16, fontWeight:400, letterSpacing:"0.04em", marginBottom:3 },
  histDate: { fontSize:11, color:"#9A8E84", letterSpacing:"0.04em" },
  histOcc: { color:"#6B5E54" },
  histMood: { color:"#C4A882", fontStyle:"italic" },
  histThumbs: { display:"flex", gap:10, padding:"0 18px 12px", overflowX:"auto" },
  histThumb: { flexShrink:0, width:56, textAlign:"center" },
  histThumbImg: { width:56, height:68, objectFit:"contain", borderRadius:6, background:"#F5F1EC" },
  histThumbPh: { width:56, height:68, borderRadius:6, background:"#F5F1EC", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, color:"#C8BFB4" },
  histThumbName: { fontSize:9, color:"#9A8E84", marginTop:3, lineHeight:1.3, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" },
  histNotes: { padding:"0 18px 12px", fontSize:12, color:"#6B5E54", fontStyle:"italic" },
  histActions: { padding:"8px 18px 14px", display:"flex", justifyContent:"space-between", alignItems:"center", borderTop:"1px solid #F0E8E0" },
  histWearBtn: { background:"none", border:"1px solid #E8E0D8", borderRadius:4, padding:"5px 12px", fontSize:11, color:"#6B5E54", cursor:"pointer", letterSpacing:"0.04em", display:"flex", alignItems:"center", gap:5 },
  histDeleteBtn: { background:"none", border:"none", fontSize:11, color:"#9A8E84", cursor:"pointer", padding:"4px 8px" },
};

// ── STYLE INSIGHTS STYLES ────────────────────────────────────────────────────
export const si = {
  card: { background:"#fff", borderRadius:10, border:"1px solid #E8E0D8", padding:"22px 24px", marginBottom:20, position:"relative", animation:"fadeIn 0.35s ease" },
  profileCard: { background:"linear-gradient(135deg, #1C1814 0%, #2A2420 100%)", borderRadius:12, padding:"26px 26px 22px", marginBottom:20, position:"relative", color:"#F5F1EC", animation:"fadeIn 0.4s ease" },
  cardDismiss: { position:"absolute", top:12, right:14, cursor:"pointer", color:"#9A8E84", fontSize:14, lineHeight:1, padding:4, opacity:0.5 },
  sectionLabel: { fontSize:9, letterSpacing:"0.22em", color:"#9A8E84", marginBottom:14, fontFamily:"sans-serif" },
  sectionHeader: { fontSize:18, fontFamily:"'DM Serif Display',Georgia,serif", fontWeight:400, letterSpacing:"0.02em", marginBottom:16, color:"#1C1814" },
  profileText: { fontSize:15, lineHeight:1.7, fontStyle:"italic", color:"#E8E0D8", marginBottom:16, fontFamily:"Georgia,serif" },
  profilePlaceholder: { fontSize:13, color:"#6B5E54", lineHeight:1.6, marginBottom:16 },
  profileBtn: { background:"none", border:"1.5px solid rgba(196,168,130,0.5)", borderRadius:4, padding:"9px 18px", fontSize:11, letterSpacing:"0.12em", color:"#C4A882", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", gap:7, fontFamily:"Georgia,serif", width:"100%" },
  divider: { height:1, background:"#F0E8E0", margin:"16px 0" },
  insightRow: { display:"flex", gap:12, alignItems:"center", padding:"8px 0", borderBottom:"1px solid #F8F5F0" },
  insightText: { fontSize:13, color:"#4A3E36", lineHeight:1.5, flex:1 },
  swatchPair: { display:"flex", gap:3, flexShrink:0 },
  swatchDot: { width:14, height:14, borderRadius:"50%", border:"1px solid rgba(0,0,0,0.08)", display:"inline-block" },
  anchorThumb: { width:36, height:36, borderRadius:6, overflow:"hidden", background:"#F5F1EC", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" },
  anchorImg: { width:"100%", height:"100%", objectFit:"contain" },
  barContainer: { display:"flex", flexDirection:"column", gap:6 },
  barRow: { display:"flex", alignItems:"center", gap:10 },
  barLabel: { width:90, fontSize:11, color:"#6B5E54", textAlign:"right", flexShrink:0 },
  barTrack: { flex:1, height:6, background:"#F0EBE4", borderRadius:3, overflow:"hidden" },
  barFill: { height:"100%", background:"#1C1814", borderRadius:3, transition:"width 0.6s ease" },
  barCount: { width:24, fontSize:11, color:"#9A8E84", textAlign:"right" },
  gapAlert: { fontSize:13, color:"#8B6914", lineHeight:1.6, padding:"10px 14px", background:"#FFF8EC", borderRadius:6, border:"1px solid #E8D5A0", marginTop:8 },
  subtleNote: { fontSize:12, color:"#9A8E84", lineHeight:1.5, marginBottom:14, marginTop:0 },
  underutilGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))", gap:10 },
  underutilCard: { background:"#FAFAF8", borderRadius:8, border:"1px solid #F0E8E0", overflow:"hidden" },
  underutilImg: { height:100, background:"#F5F1EC", display:"flex", alignItems:"center", justifyContent:"center" },
  underutilMeta: { padding:"8px 10px 10px" },
  pairGrid: { display:"flex", flexWrap:"wrap", gap:10 },
  pairChip: { display:"flex", alignItems:"center", gap:5, background:"#FAFAF8", borderRadius:20, padding:"6px 14px", border:"1px solid #F0E8E0" },
};

// ── SETS STYLES ──────────────────────────────────────────────────────────────
export const ss = {
  filterBar: { marginBottom: 16 },
  searchRow: { display: "flex", gap: 8, marginBottom: 10 },
  searchInput: { flex: 1, border: "1px solid #E8E0D8", borderRadius: 6, padding: "8px 12px", fontSize: 13, color: "#1C1814", background: "#fff", outline: "none", fontFamily: "'DM Sans',sans-serif" },
  sortSelect: { border: "1px solid #E8E0D8", borderRadius: 6, padding: "8px 10px", fontSize: 11, color: "#6B5E54", background: "#fff", cursor: "pointer", fontFamily: "'DM Sans',sans-serif", letterSpacing: "0.04em" },
  tagRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  countLabel: { fontSize: 10, letterSpacing: "0.18em", color: "#9A8E84", marginBottom: 12, fontFamily: "sans-serif" },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14 },
  card: { background: "#fff", borderRadius: 10, border: "1px solid #E8E0D8", overflow: "hidden", cursor: "pointer", transition: "box-shadow 0.2s ease" },
  collage: { width: "100%", aspectRatio: "1", background: "#F5F1EC", display: "flex", flexWrap: "wrap", overflow: "hidden" },
  collageTile: { overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", borderRight: "1px solid #F0EBE4", borderBottom: "1px solid #F0EBE4", boxSizing: "border-box" },
  collageImg: { width: "100%", height: "100%", objectFit: "contain", background: "#FAFAF8" },
  collagePlaceholder: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, color: "#C8BFB4", background: "#F5F1EC" },
  cardBody: { padding: "10px 12px 12px" },
  cardName: { fontSize: 14, fontWeight: 500, color: "#1C1814", letterSpacing: "0.02em", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "'DM Sans',sans-serif" },
  cardCount: { fontSize: 10, color: "#9A8E84", letterSpacing: "0.08em", marginBottom: 6 },
  cardTags: { display: "flex", gap: 4, flexWrap: "wrap" },
  tagChip: { fontSize: 9, letterSpacing: "0.06em", color: "#6B5E54", background: "#F5F1EC", borderRadius: 10, padding: "2px 8px" },
  modalItem: { display: "flex", gap: 10, alignItems: "center", padding: "8px 10px", background: "#FAFAF8", borderRadius: 6, cursor: "pointer", border: "1px solid #F0E8E0" },
  modalItemThumb: { width: 40, height: 50, objectFit: "contain", borderRadius: 4, flexShrink: 0, border: "1px solid #E8E0D8" },
};
