"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const COLS = 36;
const ROWS = 20;
const TOTAL_TILES = COLS * ROWS;

type MergedTile = {
  id: string;
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  width: number;
  height: number;
  imageUrl: string;
  owner: string;
  link: string;
  caption: string;
};

type Selection = {
  c: number;
  r: number;
};

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

const SAFE_SAMPLE =
  "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&w=800&q=80";

export default function Home() {
  const [mergedTiles, setMergedTiles] = useState<MergedTile[]>([]);
  const [selectedSet, setSelectedSet] = useState<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState(SAFE_SAMPLE);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState(SAFE_SAMPLE);

  const [ownerName, setOwnerName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [caption, setCaption] = useState("");

  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error" | "">("");

  const [modGuard, setModGuard] = useState(false);

  const [dragging, setDragging] = useState(false);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null
  );
  const [dragCurrent, setDragCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [shiftAnchor, setShiftAnchor] = useState<Selection | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);

  // ------------------------------------------------------------
  // Load tiles from Supabase
  // ------------------------------------------------------------

  useEffect(() => {
    loadTiles();
  }, []);

  async function loadTiles() {
    const { data, error } = await supabase
      .from("tiles")
      .select("*")
      .order("tile_index");

    if (error) {
      console.error("Supabase load error:", error);
      return;
    }

    if (!data) return;

    /*
      Your database stores individual tile indexes.
      Convert them into individual 1x1 merged-style tiles
      for display.

      If multiple tile indexes were uploaded together,
      the API created multiple rows pointing to the same image.
      We detect consecutive rectangular groups below.
    */

    const grouped = groupDatabaseTiles(data);
    setMergedTiles(grouped);
  }

  function groupDatabaseTiles(rows: any[]): MergedTile[] {
    const used = new Set<number>();
    const result: MergedTile[] = [];

    const sorted = [...rows].sort(
      (a, b) => Number(a.tile_index) - Number(b.tile_index)
    );

    for (const row of sorted) {
      const index = Number(row.tile_index);

      if (used.has(index)) continue;

      const rowNumber = Math.floor(index / COLS);
      const colNumber = index % COLS;

      /*
        Because the current API stores each selected cell separately,
        we display each database row as a 1x1 tile.

        All rows using the same image URL and owner are then visually
        combined when possible.
      */

      const sameGroup = sorted.filter(
        (x) =>
          x.image_url === row.image_url &&
          x.owner_name === row.owner_name &&
          !used.has(Number(x.tile_index))
      );

      const indexes = sameGroup.map((x) => Number(x.tile_index));

      indexes.forEach((i) => used.add(i));

      const positions = indexes.map((i) => ({
        r: Math.floor(i / COLS),
        c: i % COLS,
      }));

      const minCol = Math.min(...positions.map((p) => p.c));
      const maxCol = Math.max(...positions.map((p) => p.c));
      const minRow = Math.min(...positions.map((p) => p.r));
      const maxRow = Math.max(...positions.map((p) => p.r));

      const width = maxCol - minCol + 1;
      const height = maxRow - minRow + 1;

      /*
        Only merge if the selected cells completely fill
        the rectangular bounding area.
      */
      const expected = width * height;

      if (indexes.length === expected) {
        result.push({
          id: `db-${row.image_url}-${minCol}-${minRow}`,
          minCol,
          maxCol,
          minRow,
          maxRow,
          width,
          height,
          imageUrl: row.image_url,
          owner: row.owner_name || "Anonymous",
          link: row.website_url || "",
          caption: "",
        });
      } else {
        // Individual tile
        result.push({
          id: `db-${index}`,
          minCol: colNumber,
          maxCol: colNumber,
          minRow: rowNumber,
          maxRow: rowNumber,
          width: 1,
          height: 1,
          imageUrl: row.image_url,
          owner: row.owner_name || "Anonymous",
          link: row.website_url || "",
          caption: "",
        });
      }
    }

    return result;
  }

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------

  function tileKey(c: number, r: number) {
    return `${c},${r}`;
  }

  function getMergedTileAt(c: number, r: number) {
    return mergedTiles.find(
      (tile) =>
        c >= tile.minCol &&
        c <= tile.maxCol &&
        r >= tile.minRow &&
        r <= tile.maxRow
    );
  }

  const claimedCount = useMemo(() => {
    return mergedTiles.reduce(
      (total, tile) => total + tile.width * tile.height,
      0
    );
  }, [mergedTiles]);

  const freeCount = Math.max(0, TOTAL_TILES - claimedCount);

  // ------------------------------------------------------------
  // Selection
  // ------------------------------------------------------------

  function handleCellClick(
    e: React.MouseEvent,
    c: number,
    r: number
  ) {
    if (getMergedTileAt(c, r)) return;

    const newSelection = new Set(selectedSet);

    if (e.shiftKey && shiftAnchor) {
      const minC = Math.min(shiftAnchor.c, c);
      const maxC = Math.max(shiftAnchor.c, c);
      const minR = Math.min(shiftAnchor.r, r);
      const maxR = Math.max(shiftAnchor.r, r);

      for (let rr = minR; rr <= maxR; rr++) {
        for (let cc = minC; cc <= maxC; cc++) {
          if (!getMergedTileAt(cc, rr)) {
            newSelection.add(tileKey(cc, rr));
          }
        }
      }
    } else {
      const key = tileKey(c, r);

      if (newSelection.has(key)) {
        newSelection.delete(key);
      } else {
        newSelection.add(key);
      }

      setShiftAnchor({ c, r });
    }

    setSelectedSet(newSelection);
  }

  function clearSelection() {
    setSelectedSet(new Set());
    setShiftAnchor(null);
  }

  function getBoundingBox() {
    if (selectedSet.size === 0) return null;

    let minCol = COLS;
    let maxCol = -1;
    let minRow = ROWS;
    let maxRow = -1;

    selectedSet.forEach((key) => {
      const [c, r] = key.split(",").map(Number);

      minCol = Math.min(minCol, c);
      maxCol = Math.max(maxCol, c);
      minRow = Math.min(minRow, r);
      maxRow = Math.max(maxRow, r);
    });

    return {
      minCol,
      maxCol,
      minRow,
      maxRow,
      width: maxCol - minCol + 1,
      height: maxRow - minRow + 1,
    };
  }

  // ------------------------------------------------------------
  // Drag selection
  // ------------------------------------------------------------

  function getCellFromMouse(x: number, y: number) {
    const grid = canvasRef.current;

    if (!grid) return null;

    const rect = grid.getBoundingClientRect();

    const relativeX = x - rect.left;
    const relativeY = y - rect.top;

    const colWidth = rect.width / COLS;

    const rowHeight = rect.height / ROWS;

    const c = Math.floor(relativeX / colWidth);
    const r = Math.floor(relativeY / rowHeight);

    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) {
      return null;
    }

    return { c, r };
  }

  function startDrag(e: React.MouseEvent) {
    if (e.button !== 0) return;

    const point = getCellFromMouse(e.clientX, e.clientY);

    if (!point) return;

    if (getMergedTileAt(point.c, point.r)) return;

    setDragging(true);

    const rect = canvasRef.current?.getBoundingClientRect();

    if (!rect) return;

    setDragStart({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });

    setDragCurrent({
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });

    if (!e.shiftKey && !e.ctrlKey && !e.metaKey) {
      setSelectedSet(new Set());
    }
  }

  function moveDrag(e: React.MouseEvent) {
    if (!dragging) return;

    const grid = canvasRef.current;

    if (!grid) return;

    const rect = grid.getBoundingClientRect();

    const x = Math.max(
      0,
      Math.min(e.clientX - rect.left, rect.width)
    );

    const y = Math.max(
      0,
      Math.min(e.clientY - rect.top, rect.height)
    );

    setDragCurrent({ x, y });

    if (!dragStart) return;

    const left = Math.min(dragStart.x, x);
    const right = Math.max(dragStart.x, x);
    const top = Math.min(dragStart.y, y);
    const bottom = Math.max(dragStart.y, y);

    const colWidth = rect.width / COLS;
    const rowHeight = rect.height / ROWS;

    const startCol = Math.max(0, Math.floor(left / colWidth));
    const endCol = Math.min(
      COLS - 1,
      Math.floor(right / colWidth)
    );

    const startRow = Math.max(0, Math.floor(top / rowHeight));
    const endRow = Math.min(
      ROWS - 1,
      Math.floor(bottom / rowHeight)
    );

    const newSelection = new Set(selectedSet);

    for (let r = startRow; r <= endRow; r++) {
      for (let c = startCol; c <= endCol; c++) {
        if (!getMergedTileAt(c, r)) {
          newSelection.add(tileKey(c, r));
        }
      }
    }

    setSelectedSet(newSelection);
  }

  function stopDrag() {
    if (!dragging) return;

    setDragging(false);
    setDragStart(null);
    setDragCurrent(null);
  }

  // ------------------------------------------------------------
  // Upload modal
  // ------------------------------------------------------------

  function openUploadModal() {
    if (selectedSet.size === 0) return;

    const bbox = getBoundingBox();

    if (!bbox) return;

    setImageUrl(SAFE_SAMPLE);
    setImagePreview(SAFE_SAMPLE);
    setImageFile(null);

    setMessage("");
    setMessageType("");

    setModalOpen(true);
  }

  function closeModal() {
    if (uploading) return;

    setModalOpen(false);
    setMessage("");
    setMessageType("");
  }

  function handleFileChange(
    e: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = e.target.files?.[0];

    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setMessage("Please select an image file.");
      setMessageType("error");
      return;
    }

    if (file.size > 3 * 1024 * 1024) {
      setMessage("Image must be smaller than 3MB.");
      setMessageType("error");
      return;
    }

    setImageFile(file);

    const preview = URL.createObjectURL(file);

    setImagePreview(preview);
    setImageUrl("");
  }

  // ------------------------------------------------------------
  // Upload
  // ------------------------------------------------------------

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (selectedSet.size === 0) {
      setMessage("Select at least one tile.");
      setMessageType("error");
      return;
    }

    if (!ownerName.trim()) {
      setMessage("Please enter your name.");
      setMessageType("error");
      return;
    }

    if (!imageFile && !imageUrl.trim()) {
      setMessage("Please select an image.");
      setMessageType("error");
      return;
    }

    try {
      setUploading(true);
      setMessage("Uploading and checking image...");
      setMessageType("");

      const indexes = Array.from(selectedSet).map((key) => {
        const [c, r] = key.split(",").map(Number);
        return r * COLS + c;
      });

      const formData = new FormData();

      if (imageFile) {
        formData.append("file", imageFile);
      } else {
        /*
          The backend expects a file.
          For URL-only images, fetch the image first.
        */
        const response = await fetch(imageUrl);

        if (!response.ok) {
          throw new Error("Unable to download image from URL.");
        }

        const blob = await response.blob();

        const extension =
          blob.type.split("/")[1] || "jpg";

        const file = new File(
          [blob],
          `portfolio-image.${extension}`,
          {
            type: blob.type || "image/jpeg",
          }
        );

        formData.append("file", file);
      }

      formData.append(
        "tileIndexes",
        JSON.stringify(indexes)
      );

      formData.append(
        "ownerName",
        ownerName.trim()
      );

      formData.append(
        "websiteUrl",
        websiteUrl.trim()
      );

      const response = await fetch(
        "/api/upload-tile",
        {
          method: "POST",
          body: formData,
        }
      );

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result?.error || "Upload failed."
        );
      }

      setMessage(
        `Successfully claimed ${indexes.length} tile${
          indexes.length === 1 ? "" : "s"
        }.`
      );

      setMessageType("success");

      setSelectedSet(new Set());

      await loadTiles();

      setTimeout(() => {
        setModalOpen(false);
        setMessage("");
        setMessageType("");
      }, 1200);
    } catch (error: any) {
      console.error("UPLOAD ERROR:", error);

      setMessage(
        error?.message ||
          "Upload failed. Please try again."
      );

      setMessageType("error");
    } finally {
      setUploading(false);
    }
  }

  // ------------------------------------------------------------
  // Remove merged tile
  // ------------------------------------------------------------

  async function removeTile(tile: MergedTile) {
    if (!modGuard) return;

    const confirmed = window.confirm(
      `Remove tile by ${tile.owner}?`
    );

    if (!confirmed) return;

    /*
      The current API/database does not include a delete route.
      We therefore refresh the UI only after telling the user
      that deletion requires a backend endpoint.
    */

    alert(
      "Mod Guard is active, but deletion needs a backend delete API. We can add that next."
    );
  }

  // ------------------------------------------------------------
  // Render
  // ------------------------------------------------------------

  const bbox = getBoundingBox();

  let marqueeStyle: React.CSSProperties = {
    display: "none",
  };

  if (
    dragging &&
    dragStart &&
    dragCurrent
  ) {
    const left = Math.min(
      dragStart.x,
      dragCurrent.x
    );

    const top = Math.min(
      dragStart.y,
      dragCurrent.y
    );

    const width = Math.abs(
      dragCurrent.x - dragStart.x
    );

    const height = Math.abs(
      dragCurrent.y - dragStart.y
    );

    marqueeStyle = {
      display: "block",
      position: "absolute",
      left,
      top,
      width,
      height,
      border: "2px dashed #4f46e5",
      background: "rgba(99,102,241,0.12)",
      pointerEvents: "none",
      zIndex: 50,
      borderRadius: 4,
    };
  }

  return (
    <>
      <style jsx global>{`
        @import url("https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap");

        * {
          box-sizing: border-box;
        }

        body {
          margin: 0;
          background: #f8fafc;
          color: #0f172a;
          font-family: Inter, system-ui, sans-serif;
        }

        ::-webkit-scrollbar {
          width: 6px;
          height: 6px;
        }

        ::-webkit-scrollbar-track {
          background: #f1f5f9;
        }

        ::-webkit-scrollbar-thumb {
          background: #cbd5e1;
          border-radius: 4px;
        }

        .bg-dots {
          background-image: radial-gradient(
            #cbd5e1 1.2px,
            transparent 1.2px
          );
          background-size: 20px 20px;
        }

        .pixel-grid {
          display: grid;
          grid-template-columns: repeat(36, 1fr);
          grid-auto-rows: 24px;
          gap: 1.5px;
          background: #e2e8f0;
          padding: 1.5px;
          user-select: none;
          min-width: 920px;
          position: relative;
        }

        .unclaimed {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 2px;
          min-height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 9px;
          color: #94a3b8;
          cursor: crosshair;
          transition: 0.1s;
        }

        .unclaimed:hover {
          background: #f1f5f9;
          border-color: #6366f1;
          z-index: 10;
        }

        .unclaimed.selected {
          background: #e0e7ff;
          border-color: #4f46e5;
          box-shadow: inset 0 0 0 1px #4f46e5;
          color: #4338ca;
          font-weight: 800;
        }

        .merged {
          position: relative;
          border-radius: 4px;
          overflow: hidden;
          background-size: cover;
          background-position: center;
          border: 1.5px solid #cbd5e1;
          cursor: pointer;
          box-shadow:
            0 2px 8px -1px rgba(0,0,0,.12),
            0 1px 3px rgba(0,0,0,.08);
          transition: 0.15s ease;
          z-index: 20;
        }

        .merged:hover {
          transform: translateY(-1px) scale(1.008);
          box-shadow:
            0 10px 22px -4px rgba(0,0,0,.18);
          border-color: #4f46e5;
          z-index: 30;
        }

        .merged-info {
          position: absolute;
          bottom: 4px;
          left: 4px;
          right: 4px;
          padding: 4px 7px;
          background: rgba(15,23,42,.82);
          color: white;
          border-radius: 4px;
          font-size: 9px;
          opacity: 0;
          transition: .15s;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .merged:hover .merged-info {
          opacity: 1;
        }

        .modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 100;
          background: rgba(15,23,42,.62);
          backdrop-filter: blur(5px);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
          overflow-y: auto;
        }

        .modal {
          width: 100%;
          max-width: 500px;
          background: white;
          border-radius: 18px;
          box-shadow:
            0 20px 35px -5px rgba(15,23,42,.18),
            0 8px 10px -6px rgba(15,23,42,.1);
          overflow: hidden;
        }

        .input {
          width: 100%;
          padding: 9px 11px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          outline: none;
          font-size: 12px;
        }

        .input:focus {
          border-color: #6366f1;
          box-shadow: 0 0 0 3px #e0e7ff;
        }

        @media(max-width:700px) {
          .pixel-grid {
            min-width: 920px;
          }
        }
      `}</style>

      <div className="min-h-screen bg-dots px-3 sm:px-6 py-5">
        <div className="w-full max-w-6xl mx-auto">

          {/* ======================================================
              NAVIGATION
          ====================================================== */}

          <nav className="sticky top-2 z-40 bg-white/95 backdrop-blur-md border border-slate-200 rounded-2xl shadow-sm px-4 sm:px-6 py-2.5 mb-5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white font-mono font-bold flex items-center justify-center text-xs shadow-md">
                HP
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-bold text-xs sm:text-sm">
                    Hari Prasath
                  </span>

                  <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
                    Available
                  </span>
                </div>

                <p className="text-[10px] text-slate-500 hidden sm:block">
                  Full-Stack Engineer & Vision Systems
                </p>
              </div>
            </div>

            <div className="hidden sm:flex items-center gap-3 text-xs font-mono bg-slate-50 border border-slate-200 px-3 py-1 rounded-xl">
              <span className="text-slate-500">
                Total:
                <b className="text-slate-900 ml-1">
                  {TOTAL_TILES}
                </b>
              </span>

              <span className="text-slate-300">
                |
              </span>

              <span className="text-emerald-600">
                Free:
                <b className="ml-1">
                  {freeCount}
                </b>
              </span>

              <span className="text-slate-300">
                |
              </span>

              <span className="text-indigo-600">
                Merged:
                <b className="ml-1">
                  {mergedTiles.length}
                </b>
              </span>
            </div>

            <button
              onClick={() => setModGuard(!modGuard)}
              className={`px-2.5 py-1 rounded-xl border text-[11px] font-semibold transition ${
                modGuard
                  ? "bg-rose-50 border-rose-300 text-rose-700"
                  : "bg-white border-slate-200 text-slate-600"
              }`}
            >
              🛡 Mod Guard:{" "}
              {modGuard ? "ACTIVE" : "OFF"}
            </button>
          </nav>

          {/* ======================================================
              PORTFOLIO CARD
          ====================================================== */}

          <header className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden mb-6">
            <div className="h-1.5 w-full bg-gradient-to-r from-indigo-600 via-indigo-500 to-purple-500" />

            <div className="p-6 sm:p-7 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-5">

                <div className="relative shrink-0">
                  <div className="w-20 h-20 rounded-2xl bg-slate-900 flex items-center justify-center text-white text-2xl font-black shadow-md ring-4 ring-indigo-50">
                    HP
                  </div>

                  <span className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full bg-emerald-500 border-2 border-white" />
                </div>

                <div className="space-y-1">

                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-extrabold tracking-tight">
                      Hari Prasath
                    </h1>

                    <span className="px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 text-xs font-semibold border border-indigo-100 font-mono">
                      Full-Stack & Systems
                    </span>
                  </div>

                  <p className="text-xs sm:text-sm font-semibold text-indigo-600">
                    Distributed Architectures, Interactive Web Canvas & Computer Vision
                  </p>

                  <p className="text-xs text-slate-500 max-w-xl leading-relaxed pt-1">
                    Welcome to my living portfolio.
                    The canvas below features micro-tiles with minimal spacing.
                    <strong>
                      {" "}Multi-select any block of tiles
                    </strong>{" "}
                    to upload your image and fuse the selected cells into
                    <strong>
                      {" "}one unified photo.
                    </strong>
                  </p>

                  <div className="flex flex-wrap gap-1.5 pt-2">
                    {[
                      "React / Next.js",
                      "TypeScript",
                      "CSS Grid Fusion",
                      "PostgreSQL",
                      "AI Vision Moderation",
                    ].map((skill) => (
                      <span
                        key={skill}
                        className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded-md text-[10px] font-mono border border-slate-200"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-2 w-full lg:w-auto">
                <a
                  href="mailto:hari@example.com"
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold text-center shadow-sm"
                >
                  ✉ Get in Touch
                </a>

                <div className="flex gap-2 justify-end">
                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
                  >
                    GitHub
                  </a>

                  <a
                    href="https://linkedin.com"
                    target="_blank"
                    rel="noreferrer"
                    className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600"
                  >
                    LinkedIn
                  </a>
                </div>
              </div>
            </div>
          </header>

          {/* ======================================================
              CANVAS HEADER
          ====================================================== */}

          <section className="flex flex-wrap items-center justify-between gap-3 mb-2.5">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-sm">
                  Interactive Wall
                </span>

                <span className="px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-mono text-[10px]">
                  36 × 20 Grid
                </span>

                <span className="text-slate-400 text-[11px] hidden md:inline">
                  720 Micro-Tiles
                </span>
              </div>
            </div>

            <button
              onClick={loadTiles}
              className="px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 text-xs font-medium"
            >
              ↻ Refresh
            </button>
          </section>

          {/* ======================================================
              HELPER
          ====================================================== */}

          <div className="bg-indigo-50/70 border border-indigo-100 rounded-xl px-4 py-2 text-xs text-indigo-900 flex items-center justify-between mb-3">
            <span>
              ⚡ <strong>Select multiple tiles:</strong>{" "}
              click cells, use Shift, or drag across a block.
            </span>

            <span className="hidden sm:block text-indigo-600 text-[11px]">
              AI Safety Guard Active
            </span>
          </div>

          {/* ======================================================
              CANVAS
          ====================================================== */}

          <main className="bg-white border border-slate-200 rounded-2xl shadow-sm p-3 overflow-x-auto relative mb-20">

            <div
              ref={canvasRef}
              className="relative"
              onMouseDown={startDrag}
              onMouseMove={moveDrag}
              onMouseUp={stopDrag}
              onMouseLeave={stopDrag}
            >

              <div className="pixel-grid">

                {/* Merged images */}
                {mergedTiles.map((tile) => (
                  <div
                    key={tile.id}
                    className="merged"
                    style={{
                      gridColumn: `${tile.minCol + 1} / span ${tile.width}`,
                      gridRow: `${tile.minRow + 1} / span ${tile.height}`,
                      backgroundImage: `url("${tile.imageUrl}")`,
                    }}
                    onClick={(e) => {
                      e.stopPropagation();

                      if (modGuard) {
                        removeTile(tile);
                        return;
                      }

                      if (tile.link) {
                        window.open(
                          tile.link,
                          "_blank",
                          "noopener,noreferrer"
                        );
                      } else {
                        alert(
                          `${tile.owner}\n\n${
                            tile.caption || "Portfolio artwork"
                          }\n\nSize: ${tile.width} × ${tile.height}`
                        );
                      }
                    }}
                    title={`${tile.owner} • ${tile.width}×${tile.height}`}
                  >
                    <div className="merged-info">
                      <strong>{tile.owner}</strong>
                      {" • "}
                      {tile.width}×{tile.height}
                    </div>

                    {modGuard && (
                      <div className="absolute inset-0 bg-rose-600/80 text-white flex items-center justify-center font-bold text-xs">
                        ✕ Remove
                      </div>
                    )}
                  </div>
                ))}

                {/* Empty cells */}
                {Array.from({ length: TOTAL_TILES }).map((_, index) => {
                  const c = index % COLS;
                  const r = Math.floor(index / COLS);

                  if (getMergedTileAt(c, r)) {
                    return null;
                  }

                  const key = tileKey(c, r);
                  const selected = selectedSet.has(key);

                  return (
                    <div
                      key={key}
                      className={`unclaimed ${
                        selected ? "selected" : ""
                      }`}
                      style={{
                        gridColumn: c + 1,
                        gridRow: r + 1,
                      }}
                      onClick={(e) =>
                        handleCellClick(e, c, r)
                      }
                    >
                      {selected ? "✓" : "+"}
                    </div>
                  );
                })}
              </div>

              <div style={marqueeStyle} />
            </div>
          </main>

          {/* ======================================================
              FLOATING SELECTION BAR
          ====================================================== */}

          {selectedSet.size > 0 && (
            <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50">
              <div className="bg-slate-900 text-white rounded-2xl shadow-2xl px-5 py-3 flex items-center gap-4 text-xs border border-slate-800">

                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-pulse" />

                  <span className="font-bold">
                    {selectedSet.size} tile
                    {selectedSet.size !== 1
                      ? "s"
                      : ""}{" "}
                    selected
                  </span>

                  {bbox && (
                    <>
                      <span className="text-slate-600">
                        |
                      </span>

                      <span className="text-indigo-300 font-mono">
                        {bbox.width} × {bbox.height}
                      </span>
                    </>
                  )}
                </div>

                <button
                  onClick={clearSelection}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300"
                >
                  Deselect
                </button>

                <button
                  onClick={openUploadModal}
                  className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold shadow-md"
                >
                  🖼 Combine into 1 Tile
                </button>
              </div>
            </div>
          )}

          {/* ======================================================
              UPLOAD MODAL
          ====================================================== */}

          {modalOpen && (
            <div
              className="modal-backdrop"
              onClick={(e) => {
                if (e.target === e.currentTarget) {
                  closeModal();
                }
              }}
            >
              <div className="modal">

                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
                  <div>
                    <h3 className="text-sm font-bold">
                      Combine Selection into 1 Tile
                    </h3>

                    <p className="text-[11px] text-slate-500 mt-1">
                      {selectedSet.size} selected tile
                      {selectedSet.size !== 1
                        ? "s"
                        : ""}
                    </p>
                  </div>

                  <button
                    onClick={closeModal}
                    disabled={uploading}
                    className="p-1 text-slate-400 hover:text-slate-700"
                  >
                    ✕
                  </button>
                </div>

                {/* Form */}
                <form
                  onSubmit={handleSubmit}
                  className="p-6 space-y-4"
                >

                  {/* Preview */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">

                    <div className="flex gap-3">

                      <div className="w-28 h-28 rounded-lg overflow-hidden border border-slate-300 bg-white shrink-0">
                        <img
                          src={imagePreview}
                          alt="Preview"
                          className="w-full h-full object-cover"
                        />
                      </div>

                      <div className="flex-1">
                        <p className="font-semibold text-xs mb-2">
                          Image
                        </p>

                        <input
                          type="text"
                          value={imageUrl}
                          onChange={(e) => {
                            setImageUrl(e.target.value);
                            setImageFile(null);

                            if (e.target.value) {
                              setImagePreview(
                                e.target.value
                              );
                            }
                          }}
                          placeholder="Paste image URL"
                          className="input mb-2"
                        />

                        <label className="inline-block cursor-pointer px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-[11px] font-medium">
                          Upload from Device

                          <input
                            type="file"
                            accept="image/*"
                            className="hidden"
                            onChange={handleFileChange}
                          />
                        </label>

                        {imageFile && (
                          <p className="text-[10px] text-slate-500 mt-2 truncate">
                            {imageFile.name}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Name */}
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Your Name / Handle *
                    </label>

                    <input
                      value={ownerName}
                      onChange={(e) =>
                        setOwnerName(e.target.value)
                      }
                      maxLength={50}
                      required
                      placeholder="e.g. Hari Prasath"
                      className="input"
                    />
                  </div>

                  {/* Website */}
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Website / Social URL
                    </label>

                    <input
                      type="url"
                      value={websiteUrl}
                      onChange={(e) =>
                        setWebsiteUrl(e.target.value)
                      }
                      placeholder="https://..."
                      className="input"
                    />
                  </div>

                  {/* Caption */}
                  <div>
                    <label className="block text-xs font-semibold mb-1">
                      Artwork Caption
                    </label>

                    <input
                      value={caption}
                      onChange={(e) =>
                        setCaption(e.target.value)
                      }
                      maxLength={70}
                      placeholder="Describe your artwork"
                      className="input"
                    />
                  </div>

                  {/* Message */}
                  {message && (
                    <div
                      className={`p-3 rounded-xl text-[11px] border ${
                        messageType === "success"
                          ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                          : messageType === "error"
                          ? "bg-rose-50 border-rose-200 text-rose-700"
                          : "bg-indigo-50 border-indigo-200 text-indigo-700"
                      }`}
                    >
                      {message}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="pt-3 border-t border-slate-100 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closeModal}
                      disabled={uploading}
                      className="px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium"
                    >
                      Cancel
                    </button>

                    <button
                      type="submit"
                      disabled={uploading}
                      className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white text-xs font-semibold"
                    >
                      {uploading
                        ? "Checking & Uploading..."
                        : "Verify & Fuse into 1 Tile"}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  );
}