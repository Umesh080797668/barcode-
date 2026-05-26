import { useState, useEffect } from "react";

const STORAGE_KEY = "scanvault_tutorial_seen_v1";

/* ── self-contained palette (no host CSS dependency) ── */
const C = {
  bg:        "#0f1117",
  surface:   "#181c27",
  card:      "#1e2333",
  border:    "#2a3048",
  borderHi:  "#3b4568",
  blue:      "#4f7cff",
  blueDim:   "#1a2450",
  blueText:  "#a8bfff",
  green:     "#22c55e",
  greenDim:  "#0d2e1a",
  greenText: "#86efac",
  amber:     "#f59e0b",
  amberDim:  "#2d1f06",
  amberText: "#fcd34d",
  textPri:   "#f0f2f8",
  textSec:   "#8b93b0",
  textMut:   "#4e5672",
  white:     "#ffffff",
};

const steps = [
  {
    id: "welcome", label: "Welcome",
    title: "Welcome to ScanVault",
    subtitle: "The offline barcode scanner that writes directly to Excel — no cloud, no fuss.",
    content: null, tip: null, visual: "hero",
  },
  {
    id: "connect", label: "Connect scanner",
    title: "Plug in your scanner",
    subtitle: "No drivers. No setup. Just plug in and scan.",
    content: [
      { emoji: "🔌", text: "USB scanners are recognized instantly — they act as a keyboard to your computer." },
      { emoji: "📶", text: "Bluetooth scanners work the same once paired with your PC or Mac." },
      { emoji: "⌨️", text: "The scanner types the barcode then sends Enter. ScanVault captures it automatically." },
    ],
    tip: "Most modern scanners ship in HID keyboard mode by default. No configuration needed.",
    visual: "scanner",
  },
  {
    id: "file", label: "Select file",
    title: "Choose your Excel file",
    subtitle: "Point ScanVault at any .xlsx file on your computer.",
    content: [
      { emoji: "📂", text: "Click `Browse` in the left sidebar to select a .xlsx file on your disk." },
      { emoji: "✨", text: "No file yet? ScanVault creates columns automatically on your first scan." },
      { emoji: "📑", text: "Multiple sheets? Switch between them using the sheet chips in the sidebar." },
    ],
    tip: "Your file never leaves your computer. ScanVault is 100% offline — no cloud, no sync, ever.",
    visual: "file",
  },
  {
    id: "scan", label: "Scan barcodes",
    title: "Start scanning",
    subtitle: "Aim, fire — inventory updates in real time.",
    content: [
      { emoji: "🆕", text: "New barcode → a new row is created with quantity 1 and a timestamp." },
      { emoji: "➕", text: "Same barcode scanned again → quantity increments by +1. No duplicate rows." },
      { emoji: "✏️", text: "No scanner? Type a barcode in Manual Entry and press Enter." },
    ],
    tip: "The Scan History sidebar shows your last 100 scans with NEW / +1 badges in real time.",
    visual: "scan",
  },
  {
    id: "manage", label: "Manage data",
    title: "Manage your inventory",
    subtitle: "Search, undo mistakes, export — all built in.",
    content: [
      { emoji: "🔍", text: "Use the search bar in the Inventory tab to instantly filter rows by any value." },
      { emoji: "↩️", text: "Made a mistake? Undo / Redo in the top bar reverses up to 10 scan steps." },
      { emoji: "📤", text: "`Export CSV` saves a comma-separated snapshot of your current sheet." },
    ],
    tip: "Go to Settings to add extra columns like Location or SKU, or reorder existing ones.",
    visual: "manage",
  },
  {
    id: "done", label: "Ready!",
    title: "You're all set!",
    subtitle: "ScanVault is ready. Start scanning and your Excel file updates in real time.",
    content: null, tip: null, visual: "done",
  },
];

/* ── visuals ── */
function HeroVisual() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, padding: "20px 0 6px" }}>
      <div style={{ position: "relative" }}>
        <div style={{
          width: 88, height: 88, borderRadius: 22,
          background: "linear-gradient(145deg, #1a2040, #0d1635)",
          border: `1px solid ${C.blue}55`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 0 40px ${C.blue}28`,
        }}>
          <svg width="44" height="44" viewBox="0 0 24 24" fill="none">
            <rect x="2"   y="3" width="2.5" height="18" rx="0.5" fill="#c7d7ff"/>
            <rect x="5.5" y="3" width="1"   height="18" rx="0.5" fill="#7a9aff"/>
            <rect x="7.5" y="3" width="2"   height="18" rx="0.5" fill="#c7d7ff"/>
            <rect x="10.5"y="3" width="1"   height="18" rx="0.5" fill="#7a9aff"/>
            <rect x="12.5"y="3" width="3"   height="18" rx="0.5" fill="#c7d7ff"/>
            <rect x="16.5"y="3" width="1"   height="18" rx="0.5" fill="#7a9aff"/>
            <rect x="18.5"y="3" width="3"   height="18" rx="0.5" fill="#c7d7ff"/>
          </svg>
        </div>
        <div style={{
          position:"absolute", bottom:-5, right:-5,
          width:24, height:24, borderRadius:"50%",
          background: C.green, border:`2.5px solid ${C.surface}`,
          display:"flex", alignItems:"center", justifyContent:"center",
        }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
        <span style={{ fontSize:22, fontWeight:800, color:C.textPri, letterSpacing:"-0.5px" }}>ScanVault</span>
        <span style={{
          fontSize:10, fontWeight:700, padding:"2px 8px", borderRadius:5,
          background:C.blueDim, color:C.blueText, border:`1px solid ${C.blue}50`,
          letterSpacing:"0.05em",
        }}>OFFLINE</span>
      </div>
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", justifyContent:"center", maxWidth:340 }}>
        {[["📡","No internet needed"],["⚡","Real-time updates"],["📄","Direct .xlsx write"],["↩","Undo / Redo"]].map(([icon,label]) => (
          <div key={label} style={{
            display:"flex", alignItems:"center", gap:5,
            fontSize:11, padding:"4px 10px", borderRadius:7,
            background:C.card, border:`1px solid ${C.border}`, color:C.textSec,
          }}>
            <span style={{fontSize:12}}>{icon}</span>{label}
          </div>
        ))}
      </div>
    </div>
  );
}

function ScannerVisual() {
  const [beat, setBeat] = useState(0);
  useEffect(() => { const t = setInterval(() => setBeat(v => (v+1)%3), 900); return () => clearInterval(t); }, []);
  const active = beat === 2;
  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:16, padding:"14px 0", flexWrap:"wrap" }}>
      <div style={{
        width:58, height:86, borderRadius:10,
        background:C.card, border:`1.5px solid ${active ? C.green : C.borderHi}`,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:6,
        transition:"border-color .3s", boxShadow: active ? `0 0 14px ${C.green}40` : "none",
      }}>
        <svg width="26" height="18" viewBox="0 0 26 18" fill="none">
          {[0,3,5,8,11,14,17,20,23].map((x,i) => (
            <rect key={i} x={x} y={0} width={i%3===1?1.5:2.5} height={18} rx=".4"
              fill={active ? C.green : "#4e5672"} style={{transition:"fill .3s"}} />
          ))}
        </svg>
        <div style={{
          width:20, height:3, borderRadius:2,
          background: active ? C.green : C.borderHi,
          boxShadow: active ? `0 0 8px ${C.green}` : "none",
          transition:"all .3s",
        }}/>
      </div>
      <div style={{ display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
        <span style={{ fontSize:18, color: active ? C.green : C.textMut, transition:"color .3s" }}>→</span>
        <span style={{
          fontSize:9, color:C.textMut, background:C.card,
          padding:"1px 5px", borderRadius:4, border:`1px solid ${C.border}`, letterSpacing:".05em",
        }}>HID</span>
      </div>
      <div style={{
        minWidth:110, padding:"10px 14px", borderRadius:10, textAlign:"center",
        background: active ? "#0a2010" : C.card,
        border:`1.5px solid ${active ? C.green : C.border}`,
        transition:"all .3s",
        boxShadow: active ? `0 0 14px ${C.green}30` : "none",
      }}>
        <div style={{ fontFamily:"monospace", fontSize:13, fontWeight:700, color: active ? C.green : C.textMut, letterSpacing:".04em", transition:"color .3s" }}>
          {active ? "8901234↵" : "waiting…"}
        </div>
        <div style={{ fontSize:9, color: active ? C.greenText : C.textMut, marginTop:3 }}>
          {active ? "captured!" : "ready"}
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
        {[["🔌","USB"],["📶","Bluetooth"]].map(([icon,label]) => (
          <div key={label} style={{
            display:"flex", alignItems:"center", gap:6, padding:"5px 9px", borderRadius:7,
            background:C.card, border:`1px solid ${C.border}`,
          }}>
            <span style={{fontSize:13}}>{icon}</span>
            <span style={{fontSize:11, color:C.textSec}}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FileVisual() {
  return (
    <div style={{ display:"flex", justifyContent:"center", gap:14, padding:"14px 0", alignItems:"flex-start", flexWrap:"wrap" }}>
      <div style={{
        width:140, borderRadius:10,
        background:C.card, border:`1px solid ${C.border}`, padding:12, flexShrink:0,
      }}>
        <div style={{ fontSize:9, fontWeight:700, color:C.textMut, marginBottom:6, letterSpacing:".08em", textTransform:"uppercase" }}>Source File</div>
        <div style={{
          display:"flex", alignItems:"center", gap:7, padding:"7px 8px",
          borderRadius:7, background:C.bg, border:`1px solid ${C.blue}55`,
        }}>
          <span style={{fontSize:16}}>📗</span>
          <div>
            <div style={{fontSize:10, fontWeight:700, color:C.textPri}}>inventory.xlsx</div>
            <div style={{fontSize:8, color:C.textMut}}>C:\Documents\…</div>
          </div>
        </div>
        <button style={{
          width:"100%", marginTop:7, padding:"5px 0", borderRadius:6,
          background:C.blue, border:"none", color:C.white,
          fontSize:10, fontWeight:700, cursor:"pointer",
        }}>Browse</button>
        <div style={{marginTop:10}}>
          <div style={{fontSize:9, fontWeight:700, color:C.textMut, marginBottom:5, letterSpacing:".08em", textTransform:"uppercase"}}>Active Sheet</div>
          <div style={{display:"flex", gap:4, flexWrap:"wrap"}}>
            {["Sheet1","Sheet2"].map((s,i) => (
              <span key={s} style={{
                fontSize:9, padding:"2px 7px", borderRadius:5,
                background: i===0 ? C.blue : C.bg,
                color: i===0 ? C.white : C.textSec,
                border:`1px solid ${i===0 ? C.blue : C.border}`,
                fontWeight: i===0 ? 700 : 400,
              }}>{s}</span>
            ))}
            <span style={{fontSize:9, padding:"2px 7px", borderRadius:5, background:C.bg, color:C.textMut, border:`1px solid ${C.border}`}}>+</span>
          </div>
        </div>
      </div>
      <div style={{ display:"flex", flexDirection:"column", gap:7, paddingTop:4 }}>
        {[
          { c:C.green, dim:C.greenDim, icon:"✅", text:"Reads & writes directly" },
          { c:C.blue,  dim:C.blueDim,  icon:"🔒", text:"No Office installation needed" },
          { c:C.amber, dim:C.amberDim, icon:"📵", text:"Zero cloud or internet access" },
        ].map(p => (
          <div key={p.text} style={{
            display:"flex", alignItems:"center", gap:8, padding:"7px 11px",
            borderRadius:8, background:p.dim, border:`1px solid ${p.c}45`,
          }}>
            <span style={{fontSize:14}}>{p.icon}</span>
            <span style={{fontSize:11, color:C.textSec}}>{p.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScanVisual() {
  const [scans, setScans] = useState([
    {code:"8901234567890", type:"new", t:"09:41:02"},
    {code:"8901234567890", type:"dup", t:"09:41:15"},
  ]);
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    const pool = ["4890001234567","5012345678900","6001234567890","7350053853206"];
    const t = setInterval(() => {
      const code = pool[Math.floor(Math.random()*pool.length)];
      const now = new Date().toLocaleTimeString("en-US",{hour12:false});
      setFlash(true);
      setScans(prev => {
        const ex = prev.find(s => s.code === code);
        return [{code, type:ex?"dup":"new", t:now}, ...prev.slice(0,4)];
      });
      setTimeout(() => setFlash(false), 380);
    }, 2100);
    return () => clearInterval(t);
  }, []);
  return (
    <div style={{display:"flex", justifyContent:"center", padding:"10px 0"}}>
      <div style={{
        width:248, borderRadius:12,
        background:C.card, border:`1.5px solid ${flash ? C.green : C.border}`,
        padding:10, transition:"border-color .3s, box-shadow .3s",
        boxShadow: flash ? `0 0 20px ${C.green}35` : "none",
      }}>
        <div style={{fontSize:9, fontWeight:700, color:C.textMut, letterSpacing:".08em", textTransform:"uppercase", marginBottom:8}}>
          Scan History
        </div>
        {scans.map((s,i) => (
          <div key={i} style={{
            display:"flex", alignItems:"center", gap:8, padding:"5px 8px", borderRadius:7, marginBottom:5,
            background: i===0 ? (s.type==="new" ? "#0d2e1a" : "#2d1f06") : C.bg,
            border:`1px solid ${i===0 ? (s.type==="new" ? `${C.green}55` : `${C.amber}55`) : C.border}`,
            transition:"all .3s",
          }}>
            <span style={{
              fontSize:9, fontWeight:800, padding:"2px 5px", borderRadius:4,
              background: s.type==="new" ? C.green : C.amber,
              color: s.type==="new" ? "#fff" : "#000",
              flexShrink:0, letterSpacing:".03em",
            }}>{s.type==="new" ? "NEW" : "+1"}</span>
            <div style={{flex:1, minWidth:0}}>
              <div style={{fontFamily:"monospace", fontSize:11, fontWeight:700, color:C.textPri, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>
                {s.code}
              </div>
              <div style={{fontSize:9, color:C.textMut}}>{s.t}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManageVisual() {
  return (
    <div style={{display:"flex", justifyContent:"center", padding:"10px 0"}}>
      <div style={{width:284, display:"flex", flexDirection:"column", gap:7}}>
        <div style={{
          display:"flex", alignItems:"center", gap:7, padding:"7px 10px", borderRadius:8,
          background:C.card, border:`1px solid ${C.border}`,
        }}>
          <span style={{fontSize:13}}>🔍</span>
          <span style={{fontSize:12, color:C.textMut, flex:1}}>Filter rows…</span>
          <span style={{
            fontSize:10, padding:"1px 6px", borderRadius:5,
            background:C.bg, border:`1px solid ${C.border}`, color:C.textSec,
          }}>3 of 47</span>
        </div>
        <div style={{borderRadius:9, overflow:"hidden", border:`1px solid ${C.border}`}}>
          <div style={{display:"grid", gridTemplateColumns:"2fr .8fr 1.2fr", padding:"5px 10px", background:C.bg, gap:8}}>
            {["Barcode","Qty","Last Scanned"].map(h => (
              <span key={h} style={{fontSize:9, fontWeight:700, color:C.textMut, letterSpacing:".06em", textTransform:"uppercase"}}>{h}</span>
            ))}
          </div>
          {[
            {code:"8901234567890", qty:"5", ts:"09:41", fresh:true},
            {code:"4890001234567", qty:"2", ts:"09:39", fresh:false},
            {code:"5012345678900", qty:"1", ts:"09:37", fresh:false},
          ].map((r,i) => (
            <div key={i} style={{
              display:"grid", gridTemplateColumns:"2fr .8fr 1.2fr",
              padding:"5px 10px", gap:8, borderTop:`1px solid ${C.border}`,
              background: r.fresh ? "#0d2010" : C.card,
            }}>
              <span style={{fontFamily:"monospace", fontSize:10, color:C.textSec, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap"}}>{r.code}</span>
              <span style={{
                fontSize:10, fontWeight:800, background:C.green, color:"#fff",
                borderRadius:4, padding:"1px 5px", textAlign:"center", display:"inline-block",
              }}>{r.qty}</span>
              <span style={{fontSize:10, color:C.textMut}}>{r.ts}</span>
            </div>
          ))}
        </div>
        <div style={{display:"flex", gap:6}}>
          {[{icon:"↩",label:"Undo",c:C.blue},{icon:"↪",label:"Redo",c:C.blue},{icon:"⬇",label:"Export CSV",c:C.green}].map(b => (
            <div key={b.label} style={{
              flex:1, padding:"6px 4px", borderRadius:7, textAlign:"center",
              background:C.card, border:`1px solid ${C.border}`,
              fontSize:10, color:C.textSec, cursor:"default",
              display:"flex", alignItems:"center", justifyContent:"center", gap:4,
            }}>
              <span style={{color:b.c, fontWeight:700}}>{b.icon}</span>{b.label}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function DoneVisual() {
  return (
    <div style={{display:"flex", flexDirection:"column", alignItems:"center", gap:12, padding:"18px 0 4px"}}>
      <div style={{
        width:68, height:68, borderRadius:"50%",
        background:C.greenDim, border:`2px solid ${C.green}`,
        display:"flex", alignItems:"center", justifyContent:"center",
        boxShadow:`0 0 32px ${C.green}45`,
      }}>
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="2.5">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
      </div>
      <div style={{display:"flex", flexDirection:"column", gap:6, width:"100%", maxWidth:290}}>
        {[
          "Scanner connected via USB or Bluetooth (HID mode)",
          "Excel .xlsx file selected in the sidebar",
          "Scan barcodes to create / update inventory rows",
          "Search, filter, undo mistakes, export CSV anytime",
        ].map(label => (
          <div key={label} style={{
            display:"flex", alignItems:"center", gap:9, padding:"7px 11px", borderRadius:8,
            background:C.card, border:`1px solid ${C.border}`,
          }}>
            <div style={{
              width:18, height:18, borderRadius:"50%", flexShrink:0,
              background:C.greenDim, border:`1.5px solid ${C.green}`,
              display:"flex", alignItems:"center", justifyContent:"center",
            }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke={C.green} strokeWidth="3.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </div>
            <span style={{fontSize:12, color:C.textSec}}>{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const VISUALS = {hero:HeroVisual, scanner:ScannerVisual, file:FileVisual, scan:ScanVisual, manage:ManageVisual, done:DoneVisual};

/* ── main ── */
export default function ScanVaultTutorial() {
  const [seen, setSeen]   = useState(null);
  const [step, setStep]   = useState(0);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSeen(localStorage.getItem(STORAGE_KEY) === "true");
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = () => { localStorage.setItem(STORAGE_KEY, "true"); setSeen(true); };

  const goTo = (next) => {
    if (next === step) return;
    setFading(true);
    setTimeout(() => { setStep(next); setFading(false); }, 160);
  };

  const next = () => { if (step < steps.length-1) goTo(step+1); else dismiss(); };
  const prev = () => { if (step > 0) goTo(step-1); };

  if (seen === null || seen) return null;

  const cur    = steps[step];
  const Visual = VISUALS[cur.visual];
  const isFirst = step === 0;
  const isLast  = step === steps.length-1;

  return (
    <div
      onClick={e => { if (e.target === e.currentTarget) dismiss(); }}
      style={{
        position:"fixed", inset:0, zIndex:9999,
        background:"rgba(4,6,14,0.88)",
        backdropFilter:"blur(8px)",
        display:"flex", alignItems:"center", justifyContent:"center",
        padding:16,
        fontFamily:"'Segoe UI', system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{
        background:C.surface,
        border:`1px solid ${C.border}`,
        borderRadius:16,
        width:"100%", maxWidth:520,
        overflow:"hidden",
        boxShadow:"0 40px 90px rgba(0,0,0,0.65)",
        position:"relative",
      }}>
        {/* Progress bar */}
        <div style={{height:3, background:C.bg}}>
          <div style={{
            height:"100%", width:`${((step+1)/steps.length)*100}%`,
            background:`linear-gradient(90deg, ${C.blue}, ${C.green})`,
            transition:"width .35s cubic-bezier(0.4,0,0.2,1)",
          }}/>
        </div>

        {/* Step pills */}
        <div style={{
          display:"flex", gap:0, padding:"9px 14px",
          borderBottom:`1px solid ${C.border}`,
          background:C.bg, overflowX:"auto", scrollbarWidth: "none", msOverflowStyle: "none"
        }}>
          {steps.map((s,i) => {
            const done=i<step, active=i===step;
            return (
              <button key={s.id} onClick={() => goTo(i)} style={{
                display:"flex", alignItems:"center", gap:5,
                padding:"4px 9px", borderRadius:20, border:"none", cursor:"pointer",
                background: active ? C.blueDim : "transparent",
                flexShrink:0, transition:"background .2s",
              }}>
                <div style={{
                  width:18, height:18, borderRadius:"50%", flexShrink:0,
                  display:"flex", alignItems:"center", justifyContent:"center",
                  background: done ? C.green : active ? C.blue : C.card,
                  border:`1.5px solid ${done ? C.green : active ? C.blue : C.borderHi}`,
                  transition:"all .25s",
                }}>
                  {done
                    ? <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"/></svg>
                    : <span style={{fontSize:8, fontWeight:700, color: active ? C.white : C.textMut}}>{i+1}</span>
                  }
                </div>
                <span style={{
                  fontSize:10, fontWeight: active ? 700 : 400, whiteSpace:"nowrap",
                  color: active ? C.blueText : done ? C.textSec : C.textMut,
                }}>{s.label}</span>
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div style={{
          padding:"18px 24px 12px",
          opacity: fading ? 0 : 1,
          transform: fading ? "translateY(5px)" : "translateY(0)",
          transition:"opacity .16s, transform .16s",
        }}>
          <Visual />

          <h3 style={{
            fontSize:20, fontWeight:800, margin:"10px 0 4px",
            color:C.textPri, textAlign:"center", letterSpacing:"-0.3px",
          }}>{cur.title}</h3>
          <p style={{
            fontSize:13, color:C.textSec, textAlign:"center",
            margin:"0 0 12px", lineHeight:1.55,
          }}>{cur.subtitle}</p>

          {cur.content && (
            <div style={{display:"flex", flexDirection:"column", gap:7, marginBottom:10}}>
              {cur.content.map((item,i) => (
                <div key={i} style={{
                  display:"flex", alignItems:"flex-start", gap:10, padding:"9px 12px",
                  borderRadius:10, background:C.card, border:`1px solid ${C.border}`,
                }}>
                  <div style={{
                    width:28, height:28, borderRadius:7, flexShrink:0,
                    background:C.blueDim, border:`1px solid ${C.blue}35`,
                    display:"flex", alignItems:"center", justifyContent:"center", marginTop:1,
                  }}>
                    <span style={{fontSize:14}}>{item.emoji}</span>
                  </div>
                  <span style={{fontSize:12.5, color:C.textSec, lineHeight:1.55, paddingTop:4}}>{item.text}</span>
                </div>
              ))}
            </div>
          )}

          {cur.tip && (
            <div style={{
              display:"flex", alignItems:"flex-start", gap:8, padding:"8px 11px",
              borderRadius:9, background:"#1a1600", border:`1px solid ${C.amber}45`,
            }}>
              <span style={{fontSize:14, flexShrink:0, marginTop:1}}>💡</span>
              <span style={{fontSize:11.5, color:C.amberText, lineHeight:1.5}}>{cur.tip}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{
          display:"flex", alignItems:"center", justifyContent:"space-between",
          padding:"11px 18px", borderTop:`1px solid ${C.border}`,
          background:C.bg,
        }}>
          <button onClick={prev} disabled={isFirst} style={{
            display:"flex", alignItems:"center", gap:5,
            padding:"7px 14px", borderRadius:8,
            border:`1px solid ${C.border}`,
            background:C.card, color: isFirst ? C.white : C.textSec,
            fontSize:12, cursor: isFirst ? "not-allowed" : "pointer",
            opacity: isFirst ? 0.35 : 1, transition:"opacity .2s",
          }}>← Back</button>

          <span style={{fontSize:11, color:C.textMut, fontVariantNumeric:"tabular-nums"}}>
            {step+1} / {steps.length}
          </span>

          <button onClick={next} style={{
            display:"flex", alignItems:"center", gap:6,
            padding:"8px 18px", borderRadius:8, border:"none", cursor:"pointer",
            background: isLast ? C.green : C.blue,
            color:C.white, fontSize:13, fontWeight:700,
            boxShadow: isLast ? `0 0 18px ${C.green}55` : `0 0 18px ${C.blue}45`,
            transition:"filter .15s",
          }}>
            {isLast ? "Start scanning 🚀" : "Next →"}
          </button>
        </div>
      </div>

      {/* Skip */}
      {!isLast && (
        <div style={{position:"absolute", bottom:14, left:"50%", transform:"translateX(-50%)"}}>
          <button onClick={dismiss} style={{
            background:"none", border:"none", cursor:"pointer",
            fontSize:11, color:C.textMut, textDecoration:"underline",
          }}>Skip tutorial</button>
        </div>
      )}
    </div>
  );
}