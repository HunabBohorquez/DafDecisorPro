/**
 * DecisorPro — Matriz Ponderada de Decisiones Multicriterio (MCDA)
 * Arquitectura modular en JavaScript ES6+ Vanilla:
 *  1. DecisionMath : Cálculos de normalización, puntajes ponderados, ranking y sensibilidad.
 *  2. MatrixStore  : Gestión de estado, validación de límites y persistencia en localStorage.
 *  3. RadarChart   : Renderizado nativo en <canvas> con soporte HiDPI y ejes dinámicos.
 *  4. UIBuilder    : Construcción del DOM, sincronización de controles y exportación JSON/CSV.
 */

"use strict";

/* ==========================================================================
   1. MÓDULO DE MATEMÁTICA DE DECISIÓN (DecisionMath)
   ========================================================================== */
const DecisionMath = (() => {
  const MIN_SCORE = 1;
  const MAX_SCORE = 10;
  const MIN_WEIGHT = 1;
  const MAX_WEIGHT = 100;

  /**
   * Restringe un valor numérico dentro de un rango cerrado [min, max].
   */
  function clamp(value, min, max) {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) return min;
    return Math.min(max, Math.max(min, parsed));
  }

  /**
   * Normaliza un arreglo de pesos brutos para que sumen exactamente 1.0 (100%).
   * @param {Array<{id: string, name: string, weight: number}>} criteria
   * @returns {Array<{id: string, name: string, rawWeight: number, normWeight: number, percentage: number}>}
   */
  function normalizeCriteriaWeights(criteria) {
    const safeWeights = criteria.map((c) => clamp(c.weight, MIN_WEIGHT, MAX_WEIGHT));
    const totalRaw = safeWeights.reduce((acc, w) => acc + w, 0);

    return criteria.map((criterion, idx) => {
      const rawWeight = safeWeights[idx];
      const normWeight = totalRaw > 0 ? rawWeight / totalRaw : 1 / criteria.length;
      return {
        id: criterion.id,
        name: criterion.name,
        rawWeight,
        normWeight,
        percentage: normWeight * 100,
      };
    });
  }

  /**
   * Evalúa todas las alternativas con los pesos normalizados y devuelve el ranking ordenado.
   */
  function evaluateMatrix(alternatives, criteria, scores) {
    const normalizedCriteria = normalizeCriteriaWeights(criteria);
    const totalRawWeight = normalizedCriteria.reduce((acc, c) => acc + c.rawWeight, 0);

    const results = alternatives.map((alt) => {
      let totalScore = 0;
      const breakdown = normalizedCriteria.map((crit) => {
        const rawScore = clamp(scores?.[alt.id]?.[crit.id] ?? 5, MIN_SCORE, MAX_SCORE);
        const weightedPoints = rawScore * crit.normWeight;
        totalScore += weightedPoints;
        return {
          criterionId: crit.id,
          criterionName: crit.name,
          rawScore,
          normWeight: crit.normWeight,
          percentage: crit.percentage,
          weightedPoints,
        };
      });

      return {
        alternativeId: alt.id,
        alternativeName: alt.name,
        color: alt.color,
        totalScore,
        breakdown,
      };
    });

    const ranking = [...results].sort((a, b) => b.totalScore - a.totalScore);

    return {
      totalRawWeight,
      normalizedCriteria,
      resultsById: Object.fromEntries(results.map((r) => [r.alternativeId, r])),
      ranking,
      winner: ranking[0] || null,
    };
  }

  /**
   * Realiza el Análisis de Sensibilidad Automático:
   * Localiza el criterio de mayor peso bruto y simula un aumento (+20%) y una
   * disminución (-20%) de su peso bruto, re-normalizando los demás criterios.
   */
  function runSensitivityAnalysis(alternatives, criteria, scores) {
    const baseEval = evaluateMatrix(alternatives, criteria, scores);
    if (!baseEval.winner || criteria.length === 0) {
      return null;
    }

    // Identificar el criterio con mayor peso bruto
    let dominantCriterion = criteria[0];
    for (let i = 1; i < criteria.length; i += 1) {
      if (Number(criteria[i].weight) > Number(dominantCriterion.weight)) {
        dominantCriterion = criteria[i];
      }
    }

    const simulateShift = (factor) => {
      const shiftedCriteria = criteria.map((crit) => {
        if (crit.id !== dominantCriterion.id) return { ...crit };
        const shiftedWeight = Math.max(0.01, Number(crit.weight) * factor);
        return { ...crit, weight: shiftedWeight };
      });

      // Normalización directa sin clamp superior a 100 para reflejar +20% exacto si el peso era >83
      const totalShifted = shiftedCriteria.reduce((acc, c) => acc + Number(c.weight), 0);
      const scored = alternatives.map((alt) => {
        let total = 0;
        shiftedCriteria.forEach((crit) => {
          const wNorm = Number(crit.weight) / totalShifted;
          const s = clamp(scores?.[alt.id]?.[crit.id] ?? 5, MIN_SCORE, MAX_SCORE);
          total += s * wNorm;
        });
        return {
          alternativeId: alt.id,
          alternativeName: alt.name,
          totalScore: total,
        };
      });

      scored.sort((a, b) => b.totalScore - a.totalScore);
      const dominantObj = shiftedCriteria.find((c) => c.id === dominantCriterion.id);
      const newSharePct = ((Number(dominantObj.weight) / totalShifted) * 100).toFixed(1);

      return {
        factor,
        newRawWeight: Number(dominantObj.weight).toFixed(1),
        newNormalizedPct: newSharePct,
        ranking: scored,
        winner: scored[0],
        runnerUp: scored[1] || null,
      };
    };

    const increaseScenario = simulateShift(1.2);
    const decreaseScenario = simulateShift(0.8);

    const baseWinnerId = baseEval.winner.alternativeId;
    const isStable =
      increaseScenario.winner.alternativeId === baseWinnerId &&
      decreaseScenario.winner.alternativeId === baseWinnerId;

    return {
      isStable,
      statusLabel: isStable
        ? "Estable (la opción ganadora no cambia)"
        : "Sensible (otra alternativa toma el primer lugar)",
      baseWinner: baseEval.winner,
      dominantCriterion: {
        id: dominantCriterion.id,
        name: dominantCriterion.name,
        rawWeight: Number(dominantCriterion.weight),
        basePct: baseEval.normalizedCriteria
          .find((c) => c.id === dominantCriterion.id)
          .percentage.toFixed(1),
      },
      increaseScenario,
      decreaseScenario,
    };
  }

  /**
   * Genera contenido CSV limpio listo para descarga.
   */
  function buildCSV(state, evaluation) {
    const escapeCSV = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const headers = [
      "Criterio",
      "Peso Bruto",
      "Peso Normalizado (%)",
      ...state.alternatives.map((a) => `${a.name} (Calificación 1-10)`),
    ];

    const rows = [headers.map(escapeCSV).join(",")];

    evaluation.normalizedCriteria.forEach((crit) => {
      const row = [
        crit.name,
        crit.rawWeight,
        crit.percentage.toFixed(2),
        ...state.alternatives.map((alt) => state.scores[alt.id]?.[crit.id] ?? 5),
      ];
      rows.push(row.map(escapeCSV).join(","));
    });

    const totalRow = [
      "PUNTAJE PONDERADO TOTAL (0-10)",
      evaluation.totalRawWeight,
      "100.00",
      ...state.alternatives.map((alt) =>
        evaluation.resultsById[alt.id].totalScore.toFixed(2)
      ),
    ];
    rows.push(totalRow.map(escapeCSV).join(","));

    return rows.join("\r\n");
  }

  return {
    MIN_SCORE,
    MAX_SCORE,
    MIN_WEIGHT,
    MAX_WEIGHT,
    clamp,
    normalizeCriteriaWeights,
    evaluateMatrix,
    runSensitivityAnalysis,
    buildCSV,
  };
})();

/* ==========================================================================
   2. MÓDULO DE ALMACENAMIENTO Y ESTADO (MatrixStore)
   ========================================================================== */
const MatrixStore = (() => {
  const STORAGE_KEY = "decisorpro_matrix_state_v1";
  const MIN_ALTERNATIVES = 2;
  const MAX_ALTERNATIVES = 6;
  const MIN_CRITERIA = 3;
  const MAX_CRITERIA = 8;

  const PALETTE = [
    "#6366f1", // Índigo
    "#10b981", // Esmeralda
    "#f59e0b", // Ámbar
    "#ec4899", // Rosa
    "#06b6d4", // Cian
    "#a855f7", // Púrpura
  ];

  const CRITERION_COLORS = [
    "#38bdf8",
    "#818cf8",
    "#34d399",
    "#fbbf24",
    "#f472b6",
    "#a78bfa",
    "#fb923c",
    "#2dd4bf",
  ];

  let state = null;
  const listeners = new Set();

  function generateId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  /**
   * Construye el escenario de demostración: 3 laptops bajo 5 criterios.
   */
  function createDemoState() {
    const criteria = [
      { id: "crit_precio", name: "Precio", weight: 25 },
      { id: "crit_rendimiento", name: "Rendimiento", weight: 30 },
      { id: "crit_bateria", name: "Batería", weight: 20 },
      { id: "crit_portabilidad", name: "Portabilidad", weight: 15 },
      { id: "crit_pantalla", name: "Pantalla", weight: 10 },
    ];

    const alternatives = [
      { id: "alt_laptop_a", name: "Laptop A (Ultrabook Pro 14)", color: PALETTE[0] },
      { id: "alt_laptop_b", name: "Laptop B (Workstation X15)", color: PALETTE[1] },
      { id: "alt_laptop_c", name: "Laptop C (AirBook Lite 13)", color: PALETTE[2] },
    ];

    const scores = {
      alt_laptop_a: {
        crit_precio: 6,
        crit_rendimiento: 8,
        crit_bateria: 9,
        crit_portabilidad: 9,
        crit_pantalla: 9,
      },
      alt_laptop_b: {
        crit_precio: 5,
        crit_rendimiento: 10,
        crit_bateria: 6,
        crit_portabilidad: 5,
        crit_pantalla: 9,
      },
      alt_laptop_c: {
        crit_precio: 9,
        crit_rendimiento: 6,
        crit_bateria: 8,
        crit_portabilidad: 10,
        crit_pantalla: 7,
      },
    };

    return {
      title: "Selección de Laptop de Ingeniería",
      alternatives,
      criteria,
      scores,
      hiddenAlternatives: [],
    };
  }

  function isValidState(candidate) {
    if (!candidate || typeof candidate !== "object") return false;
    if (!Array.isArray(candidate.alternatives) || !Array.isArray(candidate.criteria)) return false;
    if (
      candidate.alternatives.length < MIN_ALTERNATIVES ||
      candidate.alternatives.length > MAX_ALTERNATIVES
    ) {
      return false;
    }
    if (candidate.criteria.length < MIN_CRITERIA || candidate.criteria.length > MAX_CRITERIA) {
      return false;
    }
    return typeof candidate.scores === "object" && candidate.scores !== null;
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (err) {
      console.warn("No se pudo guardar en localStorage:", err);
    }
  }

  function notify() {
    persist();
    listeners.forEach((fn) => fn(getState()));
  }

  function init() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (isValidState(parsed)) {
          state = {
            hiddenAlternatives: [],
            ...parsed,
          };
          return;
        }
      }
    } catch (err) {
      console.warn("Error leyendo estado guardado, cargando demo:", err);
    }
    state = createDemoState();
    persist();
  }

  function getState() {
    return structuredClone(state);
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function loadDemo() {
    state = createDemoState();
    notify();
  }

  function setTitle(newTitle) {
    state.title = String(newTitle || "").slice(0, 80);
    notify();
  }

  function addAlternative() {
    if (state.alternatives.length >= MAX_ALTERNATIVES) {
      return { ok: false, message: `Máximo permitido: ${MAX_ALTERNATIVES} alternativas.` };
    }
    const usedColors = new Set(state.alternatives.map((a) => a.color));
    const nextColor =
      PALETTE.find((c) => !usedColors.has(c)) || PALETTE[state.alternatives.length % PALETTE.length];

    const newAlt = {
      id: generateId("alt"),
      name: `Opción ${String.fromCharCode(65 + state.alternatives.length)}`,
      color: nextColor,
    };

    state.alternatives.push(newAlt);
    state.scores[newAlt.id] = {};
    state.criteria.forEach((crit) => {
      state.scores[newAlt.id][crit.id] = 5;
    });

    notify();
    return { ok: true };
  }

  function removeAlternative(altId) {
    if (state.alternatives.length <= MIN_ALTERNATIVES) {
      return { ok: false, message: `Debe haber al menos ${MIN_ALTERNATIVES} alternativas.` };
    }
    state.alternatives = state.alternatives.filter((a) => a.id !== altId);
    delete state.scores[altId];
    state.hiddenAlternatives = state.hiddenAlternatives.filter((id) => id !== altId);
    notify();
    return { ok: true };
  }

  function updateAlternativeName(altId, name) {
    const target = state.alternatives.find((a) => a.id === altId);
    if (!target) return;
    target.name = name.trim() || "Alternativa sin nombre";
    notify();
  }

  function addCriterion() {
    if (state.criteria.length >= MAX_CRITERIA) {
      return { ok: false, message: `Máximo permitido: ${MAX_CRITERIA} criterios.` };
    }
    const newCrit = {
      id: generateId("crit"),
      name: `Criterio ${state.criteria.length + 1}`,
      weight: 15,
    };

    state.criteria.push(newCrit);
    state.alternatives.forEach((alt) => {
      if (!state.scores[alt.id]) state.scores[alt.id] = {};
      state.scores[alt.id][newCrit.id] = 5;
    });

    notify();
    return { ok: true };
  }

  function removeCriterion(critId) {
    if (state.criteria.length <= MIN_CRITERIA) {
      return { ok: false, message: `Debe haber al menos ${MIN_CRITERIA} criterios.` };
    }
    state.criteria = state.criteria.filter((c) => c.id !== critId);
    state.alternatives.forEach((alt) => {
      if (state.scores[alt.id]) {
        delete state.scores[alt.id][critId];
      }
    });
    notify();
    return { ok: true };
  }

  function updateCriterionName(critId, name) {
    const target = state.criteria.find((c) => c.id === critId);
    if (!target) return;
    target.name = name.trim() || "Criterio sin nombre";
    notify();
  }

  function updateCriterionWeight(critId, rawWeight) {
    const target = state.criteria.find((c) => c.id === critId);
    if (!target) return;
    target.weight = Math.round(
      DecisionMath.clamp(rawWeight, DecisionMath.MIN_WEIGHT, DecisionMath.MAX_WEIGHT)
    );
    notify();
  }

  function updateScore(altId, critId, rawScore) {
    if (!state.scores[altId]) state.scores[altId] = {};
    const clamped = DecisionMath.clamp(rawScore, DecisionMath.MIN_SCORE, DecisionMath.MAX_SCORE);
    // Permitir pasos de 0.5 o enteros limpios
    state.scores[altId][critId] = Math.round(clamped * 10) / 10;
    notify();
  }

  function toggleAlternativeVisibility(altId) {
    if (state.hiddenAlternatives.includes(altId)) {
      state.hiddenAlternatives = state.hiddenAlternatives.filter((id) => id !== altId);
    } else {
      state.hiddenAlternatives.push(altId);
    }
    notify();
  }

  return {
    MIN_ALTERNATIVES,
    MAX_ALTERNATIVES,
    MIN_CRITERIA,
    MAX_CRITERIA,
    CRITERION_COLORS,
    init,
    getState,
    subscribe,
    loadDemo,
    setTitle,
    addAlternative,
    removeAlternative,
    updateAlternativeName,
    addCriterion,
    removeCriterion,
    updateCriterionName,
    updateCriterionWeight,
    updateScore,
    toggleAlternativeVisibility,
  };
})();

/* ==========================================================================
   3. MÓDULO DE GRÁFICO DE RADAR NATIVO EN CANVAS (RadarChart)
   ========================================================================== */
const RadarChart = (() => {
  const SCALE_RINGS = [2, 4, 6, 8, 10];
  const MAX_SCALE = 10;

  /**
   * Convierte un color hexadecimal (#RRGGBB) a rgba(r, g, b, alpha).
   */
  function hexToRgba(hex, alpha) {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16);
    const g = parseInt(clean.substring(2, 4), 16);
    const b = parseInt(clean.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  /**
   * Dibuja la tela de araña completa en el elemento <canvas>.
   */
  function render(canvas, state, evaluation) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const logicalWidth = 560;
    const logicalHeight = 460;

    if (canvas.width !== logicalWidth * dpr || canvas.height !== logicalHeight * dpr) {
      canvas.width = logicalWidth * dpr;
      canvas.height = logicalHeight * dpr;
    }

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, logicalWidth, logicalHeight);

    const centerX = logicalWidth / 2;
    const centerY = logicalHeight / 2 + 8;
    const radius = Math.min(logicalWidth, logicalHeight) * 0.34;
    const numAxes = state.criteria.length;
    const angleStep = (Math.PI * 2) / numAxes;
    const startAngle = -Math.PI / 2; // Comenzar a las 12 en punto

    // 1. Dibujar anillos concéntricos de escala (2, 4, 6, 8, 10)
    SCALE_RINGS.forEach((ringValue) => {
      const ringRadius = (ringValue / MAX_SCALE) * radius;
      ctx.beginPath();
      for (let i = 0; i < numAxes; i += 1) {
        const angle = startAngle + i * angleStep;
        const x = centerX + Math.cos(angle) * ringRadius;
        const y = centerY + Math.sin(angle) * ringRadius;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = ringValue === MAX_SCALE ? "#475569" : "#334155";
      ctx.lineWidth = ringValue === MAX_SCALE ? 1.5 : 1;
      ctx.stroke();

      // Etiqueta numérica del anillo sobre el eje vertical superior
      ctx.fillStyle = "#94a3b8";
      ctx.font = "600 10px system-ui, -apple-system, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(String(ringValue), centerX + 5, centerY - ringRadius);
    });

    // 2. Dibujar ejes radiales y etiquetas de criterios
    evaluation.normalizedCriteria.forEach((crit, idx) => {
      const angle = startAngle + idx * angleStep;
      const endX = centerX + Math.cos(angle) * radius;
      const endY = centerY + Math.sin(angle) * radius;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(endX, endY);
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      ctx.stroke();

      // Posicionamiento inteligente de etiquetas alrededor del perímetro
      const labelDist = radius + 24;
      const labelX = centerX + Math.cos(angle) * labelDist;
      const labelY = centerY + Math.sin(angle) * labelDist;

      const cosVal = Math.cos(angle);
      const sinVal = Math.sin(angle);

      if (Math.abs(cosVal) < 0.15) ctx.textAlign = "center";
      else if (cosVal > 0) ctx.textAlign = "left";
      else ctx.textAlign = "right";

      if (Math.abs(sinVal) < 0.15) ctx.textBaseline = "middle";
      else if (sinVal > 0) ctx.textBaseline = "top";
      else ctx.textBaseline = "bottom";

      const shortName = crit.name.length > 18 ? `${crit.name.slice(0, 16)}…` : crit.name;
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 12px system-ui, -apple-system, sans-serif";
      ctx.fillText(shortName, labelX, labelY - 6);

      ctx.fillStyle = "#38bdf8";
      ctx.font = "600 10.5px system-ui, -apple-system, sans-serif";
      ctx.fillText(`(${crit.percentage.toFixed(1)}%)`, labelX, labelY + 8);
    });

    // 3. Dibujar polígonos de cada alternativa activa
    const visibleAlternatives = state.alternatives.filter(
      (alt) => !state.hiddenAlternatives.includes(alt.id)
    );

    visibleAlternatives.forEach((alt) => {
      const points = state.criteria.map((crit, idx) => {
        const score = DecisionMath.clamp(state.scores[alt.id]?.[crit.id] ?? 5, 1, 10);
        const r = (score / MAX_SCALE) * radius;
        const angle = startAngle + idx * angleStep;
        return {
          x: centerX + Math.cos(angle) * r,
          y: centerY + Math.sin(angle) * r,
        };
      });

      if (points.length < 3) return;

      // Relleno semitransparente
      ctx.beginPath();
      points.forEach((pt, idx) => {
        if (idx === 0) ctx.moveTo(pt.x, pt.y);
        else ctx.lineTo(pt.x, pt.y);
      });
      ctx.closePath();
      ctx.fillStyle = hexToRgba(alt.color, 0.22);
      ctx.fill();

      // Contorno sólido
      ctx.strokeStyle = alt.color;
      ctx.lineWidth = 2.4;
      ctx.stroke();

      // Nodos en cada vértice
      points.forEach((pt) => {
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = alt.color;
        ctx.fill();
        ctx.strokeStyle = "#0f172a";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });
    });

    ctx.restore();
  }

  return { render };
})();

/* ==========================================================================
   4. MÓDULO DE CONSTRUCCIÓN Y EVENTOS DE INTERFAZ (UIBuilder)
   ========================================================================== */
const UIBuilder = (() => {
  const dom = {};

  function cacheDOM() {
    dom.titleInput = document.getElementById("decision-title-input");
    dom.btnLoadDemo = document.getElementById("btn-load-demo");
    dom.btnExportJson = document.getElementById("btn-export-json");
    dom.btnExportCsv = document.getElementById("btn-export-csv");
    dom.btnAddCriterion = document.getElementById("btn-add-criterion");
    dom.btnAddAlternative = document.getElementById("btn-add-alternative");
    dom.weightSummaryBadge = document.getElementById("weight-summary-badge");
    dom.thead = document.getElementById("matrix-thead");
    dom.tbody = document.getElementById("matrix-tbody");
    dom.tfoot = document.getElementById("matrix-tfoot");
    dom.rankingContainer = document.getElementById("ranking-container");
    dom.sensitivityContainer = document.getElementById("sensitivity-container");
    dom.radarLegend = document.getElementById("radar-legend");
    dom.radarCanvas = document.getElementById("radar-canvas");
    dom.toastContainer = document.getElementById("toast-container");
  }

  function showToast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    dom.toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 3000);
  }

  function escapeHTML(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * Renderiza la tabla completa de criterios, pesos y calificaciones.
   */
  function renderMatrixTable(state, evaluation) {
    const disableRemoveAlt = state.alternatives.length <= MatrixStore.MIN_ALTERNATIVES;
    const disableRemoveCrit = state.criteria.length <= MatrixStore.MIN_CRITERIA;

    // Cabecera
    const altHeaders = state.alternatives
      .map(
        (alt) => `
        <th class="col-alternative">
          <div class="alt-header-box">
            <div class="alt-header-top">
              <span class="alt-color-dot" style="background-color: ${alt.color};"></span>
              <input
                type="text"
                class="inline-name-input"
                data-action="rename-alt"
                data-alt-id="${alt.id}"
                value="${escapeHTML(alt.name)}"
                maxlength="40"
                aria-label="Nombre de alternativa ${escapeHTML(alt.name)}"
              />
              <button
                type="button"
                class="btn-icon-danger"
                data-action="remove-alt"
                data-alt-id="${alt.id}"
                title="Eliminar alternativa"
                ${disableRemoveAlt ? "disabled" : ""}
              >&times;</button>
            </div>
          </div>
        </th>`
      )
      .join("");

    dom.thead.innerHTML = `
      <tr>
        <th class="col-criterion">Criterio de Evaluación</th>
        <th class="col-weight">Peso (1–100) &amp; Real %</th>
        ${altHeaders}
      </tr>
    `;

    // Filas de criterios
    dom.tbody.innerHTML = evaluation.normalizedCriteria
      .map((crit) => {
        const scoreCells = state.alternatives
          .map((alt) => {
            const score = state.scores[alt.id]?.[crit.id] ?? 5;
            const contribution = (score * crit.normWeight).toFixed(2);
            return `
              <td>
                <div class="score-cell-box">
                  <div class="score-inputs-row">
                    <input
                      type="range"
                      class="score-slider"
                      min="1"
                      max="10"
                      step="0.5"
                      value="${score}"
                      data-action="score-input"
                      data-alt-id="${alt.id}"
                      data-crit-id="${crit.id}"
                      aria-label="Deslizador calificación ${escapeHTML(alt.name)} en ${escapeHTML(crit.name)}"
                    />
                    <input
                      type="number"
                      class="score-number-input"
                      min="1"
                      max="10"
                      step="0.5"
                      value="${score}"
                      data-action="score-input"
                      data-alt-id="${alt.id}"
                      data-crit-id="${crit.id}"
                      aria-label="Valor numérico ${escapeHTML(alt.name)} en ${escapeHTML(crit.name)}"
                    />
                  </div>
                  <div class="score-contribution-hint" data-contrib-cell="${alt.id}__${crit.id}">
                    Aporte: +${contribution} pts
                  </div>
                </div>
              </td>
            `;
          })
          .join("");

        return `
          <tr>
            <td>
              <div class="criterion-cell-box">
                <input
                  type="text"
                  class="inline-name-input"
                  data-action="rename-crit"
                  data-crit-id="${crit.id}"
                  value="${escapeHTML(crit.name)}"
                  maxlength="36"
                  aria-label="Nombre de criterio ${escapeHTML(crit.name)}"
                />
                <button
                  type="button"
                  class="btn-icon-danger"
                  data-action="remove-crit"
                  data-crit-id="${crit.id}"
                  title="Eliminar criterio"
                  ${disableRemoveCrit ? "disabled" : ""}
                >&times;</button>
              </div>
            </td>
            <td>
              <div class="weight-control-box">
                <div class="weight-input-row">
                  <input
                    type="number"
                    class="weight-number-input"
                    min="1"
                    max="100"
                    step="1"
                    value="${crit.rawWeight}"
                    data-action="weight-input"
                    data-crit-id="${crit.id}"
                    aria-label="Peso bruto de ${escapeHTML(crit.name)}"
                  />
                  <span class="weight-norm-pill" data-weight-pct="${crit.id}">
                    ${crit.percentage.toFixed(1)}%
                  </span>
                </div>
                <div class="weight-bar-track">
                  <div
                    class="weight-bar-fill"
                    data-weight-bar="${crit.id}"
                    style="width: ${Math.min(100, crit.percentage).toFixed(1)}%;"
                  ></div>
                </div>
              </div>
            </td>
            ${scoreCells}
          </tr>
        `;
      })
      .join("");

    // Pie de tabla con totales ponderados
    const winnerId = evaluation.winner ? evaluation.winner.alternativeId : null;
    const totalCells = state.alternatives
      .map((alt) => {
        const res = evaluation.resultsById[alt.id];
        const isWinner = alt.id === winnerId;
        return `
          <td>
            <div class="total-score-cell">
              <span class="total-score-value" data-total-alt="${alt.id}">
                ${res.totalScore.toFixed(2)} / 10
              </span>
              ${isWinner ? '<span class="winner-tag-mini">Ganadora</span>' : ""}
            </div>
          </td>
        `;
      })
      .join("");

    dom.tfoot.innerHTML = `
      <tr>
        <td>Puntaje Ponderado Total</td>
        <td>100.0% (Base ${evaluation.totalRawWeight})</td>
        ${totalCells}
      </tr>
    `;
  }

  /**
   * Renderiza las tarjetas del Ranking ordenado con desglose de puntos por criterio.
   */
  function renderRanking(evaluation) {
    dom.rankingContainer.innerHTML = evaluation.ranking
      .map((item, idx) => {
        const isWinner = idx === 0;
        const segments = item.breakdown
          .map((b, cIdx) => {
            const widthPct = (b.weightedPoints / 10) * 100;
            const segColor = MatrixStore.CRITERION_COLORS[cIdx % MatrixStore.CRITERION_COLORS.length];
            return `<div class="stacked-segment" style="width: ${widthPct.toFixed(2)}%; background-color: ${segColor};" title="${escapeHTML(b.criterionName)}: +${b.weightedPoints.toFixed(2)} pts"></div>`;
          })
          .join("");

        const chips = item.breakdown
          .map(
            (b) => `
            <span class="breakdown-chip">
              ${escapeHTML(b.criterionName)}: <strong>+${b.weightedPoints.toFixed(2)}</strong>
              <small>(${b.rawScore}&times;${b.percentage.toFixed(0)}%)</small>
            </span>`
          )
          .join("");

        return `
          <article class="ranking-item ${isWinner ? "is-winner" : ""}">
            <div class="ranking-item-header">
              <div class="ranking-identity">
                <span class="rank-position">#${idx + 1}</span>
                <span class="alt-color-dot" style="background-color: ${item.color};"></span>
                <span class="ranking-name">${escapeHTML(item.alternativeName)}</span>
                ${isWinner ? '<span class="winner-crown">Opción Ganadora</span>' : ""}
              </div>
              <div class="ranking-score-badge">
                ${item.totalScore.toFixed(2)} <small>/ 10.00</small>
              </div>
            </div>
            <div class="stacked-bar" aria-hidden="true">${segments}</div>
            <div class="breakdown-chips">${chips}</div>
          </article>
        `;
      })
      .join("");
  }

  /**
   * Renderiza el resultado del Análisis de Sensibilidad Automático (±20%).
   */
  function renderSensitivity(sensitivity) {
    if (!sensitivity) {
      dom.sensitivityContainer.innerHTML = "";
      return;
    }

    const statusClass = sensitivity.isStable ? "stable" : "sensitive";
    const { dominantCriterion, increaseScenario, decreaseScenario, baseWinner } = sensitivity;

    const explanation = sensitivity.isStable
      ? `Al variar ±20% el criterio dominante "${escapeHTML(dominantCriterion.name)}" (peso base ${dominantCriterion.rawWeight} / ${dominantCriterion.basePct}%), "${escapeHTML(baseWinner.alternativeName)}" conserva el primer lugar en ambos escenarios.`
      : `Al variar ±20% el criterio dominante "${escapeHTML(dominantCriterion.name)}" (peso base ${dominantCriterion.rawWeight} / ${dominantCriterion.basePct}%), la alternativa ganadora cambia respecto a "${escapeHTML(baseWinner.alternativeName)}".`;

    dom.sensitivityContainer.innerHTML = `
      <div class="sensitivity-banner ${statusClass}">
        <p class="sensitivity-status-title">${escapeHTML(sensitivity.statusLabel)}</p>
        <p class="sensitivity-explanation">${explanation}</p>
      </div>
      <div class="sensitivity-scenarios">
        <div class="scenario-card">
          <h4>Escenario +20% en ${escapeHTML(dominantCriterion.name)}</h4>
          <p class="scenario-winner">
            1.º ${escapeHTML(increaseScenario.winner.alternativeName)} (${increaseScenario.winner.totalScore.toFixed(2)})
          </p>
          <p class="scenario-detail">
            Peso ajustado: ${increaseScenario.newRawWeight} (${increaseScenario.newNormalizedPct}% normalizado)
          </p>
        </div>
        <div class="scenario-card">
          <h4>Escenario -20% en ${escapeHTML(dominantCriterion.name)}</h4>
          <p class="scenario-winner">
            1.º ${escapeHTML(decreaseScenario.winner.alternativeName)} (${decreaseScenario.winner.totalScore.toFixed(2)})
          </p>
          <p class="scenario-detail">
            Peso ajustado: ${decreaseScenario.newRawWeight} (${decreaseScenario.newNormalizedPct}% normalizado)
          </p>
        </div>
      </div>
    `;
  }

  /**
   * Renderiza la leyenda interactiva del Gráfico de Radar.
   */
  function renderRadarLegend(state) {
    dom.radarLegend.innerHTML = state.alternatives
      .map((alt) => {
        const isHidden = state.hiddenAlternatives.includes(alt.id);
        return `
          <button
            type="button"
            class="legend-item ${isHidden ? "is-hidden" : ""}"
            data-action="toggle-radar-alt"
            data-alt-id="${alt.id}"
            title="Mostrar u ocultar en el radar"
          >
            <span class="legend-swatch" style="background-color: ${alt.color};"></span>
            <span>${escapeHTML(alt.name)}</span>
          </button>
        `;
      })
      .join("");
  }

  /**
   * Actualización parcial rápida para cuando el usuario arrastra un slider o edita números,
   * evitando destruir el foco del elemento activo.
   */
  function syncDynamicValues(state, evaluation) {
    dom.weightSummaryBadge.textContent = `Suma bruta: ${evaluation.totalRawWeight} → Normalizado: 100.0%`;

    evaluation.normalizedCriteria.forEach((crit) => {
      const pctEl = dom.tbody.querySelector(`[data-weight-pct="${crit.id}"]`);
      const barEl = dom.tbody.querySelector(`[data-weight-bar="${crit.id}"]`);
      if (pctEl) pctEl.textContent = `${crit.percentage.toFixed(1)}%`;
      if (barEl) barEl.style.width = `${Math.min(100, crit.percentage).toFixed(1)}%`;

      state.alternatives.forEach((alt) => {
        const score = state.scores[alt.id]?.[crit.id] ?? 5;
        const contribEl = dom.tbody.querySelector(
          `[data-contrib-cell="${alt.id}__${crit.id}"]`
        );
        if (contribEl) {
          contribEl.textContent = `Aporte: +${(score * crit.normWeight).toFixed(2)} pts`;
        }
      });
    });

    const winnerId = evaluation.winner ? evaluation.winner.alternativeId : null;
    state.alternatives.forEach((alt) => {
      const totalEl = dom.tfoot.querySelector(`[data-total-alt="${alt.id}"]`);
      if (totalEl) {
        const res = evaluation.resultsById[alt.id];
        totalEl.textContent = `${res.totalScore.toFixed(2)} / 10`;
        const parentCell = totalEl.closest(".total-score-cell");
        const existingTag = parentCell.querySelector(".winner-tag-mini");
        if (alt.id === winnerId && !existingTag) {
          parentCell.insertAdjacentHTML("beforeend", '<span class="winner-tag-mini">Ganadora</span>');
        } else if (alt.id !== winnerId && existingTag) {
          existingTag.remove();
        }
      }
    });
  }

  let structuralSignature = "";

  function getStructuralSignature(state) {
    const altIds = state.alternatives.map((a) => `${a.id}:${a.name}`).join("|");
    const critIds = state.criteria.map((c) => `${c.id}:${c.name}`).join("|");
    return `${altIds}__${critIds}`;
  }

  function renderAll(state) {
    if (document.activeElement !== dom.titleInput) {
      dom.titleInput.value = state.title || "";
    }

    const evaluation = DecisionMath.evaluateMatrix(
      state.alternatives,
      state.criteria,
      state.scores
    );
    const sensitivity = DecisionMath.runSensitivityAnalysis(
      state.alternatives,
      state.criteria,
      state.scores
    );

    const nextSignature = getStructuralSignature(state);
    if (nextSignature !== structuralSignature) {
      renderMatrixTable(state, evaluation);
      structuralSignature = nextSignature;
    }
    syncDynamicValues(state, evaluation);
    renderRanking(evaluation);
    renderSensitivity(sensitivity);
    renderRadarLegend(state);
    RadarChart.render(dom.radarCanvas, state, evaluation);
  }

  function triggerDownload(filename, content, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function bindEvents() {
    dom.titleInput.addEventListener("input", (e) => {
      MatrixStore.setTitle(e.target.value);
    });

    dom.btnLoadDemo.addEventListener("click", () => {
      structuralSignature = "";
      MatrixStore.loadDemo();
      showToast("Decisión Demo cargada (3 laptops, 5 criterios).");
    });

    dom.btnAddAlternative.addEventListener("click", () => {
      const res = MatrixStore.addAlternative();
      if (!res.ok) showToast(res.message);
    });

    dom.btnAddCriterion.addEventListener("click", () => {
      const res = MatrixStore.addCriterion();
      if (!res.ok) showToast(res.message);
    });

    dom.btnExportJson.addEventListener("click", () => {
      const current = MatrixStore.getState();
      const evaluation = DecisionMath.evaluateMatrix(
        current.alternatives,
        current.criteria,
        current.scores
      );
      const sensitivity = DecisionMath.runSensitivityAnalysis(
        current.alternatives,
        current.criteria,
        current.scores
      );
      const payload = {
        exportedAt: new Date().toISOString(),
        decisionTitle: current.title,
        matrix: {
          alternatives: current.alternatives,
          criteria: evaluation.normalizedCriteria,
          scores: current.scores,
        },
        ranking: evaluation.ranking,
        sensitivityAnalysis: sensitivity,
      };
      triggerDownload(
        "decisorpro-matriz.json",
        JSON.stringify(payload, null, 2),
        "application/json;charset=utf-8"
      );
      showToast("Matriz exportada en formato JSON.");
    });

    dom.btnExportCsv.addEventListener("click", () => {
      const current = MatrixStore.getState();
      const evaluation = DecisionMath.evaluateMatrix(
        current.alternatives,
        current.criteria,
        current.scores
      );
      const csvText = DecisionMath.buildCSV(current, evaluation);
      triggerDownload(
        "decisorpro-matriz.csv",
        "\uFEFF" + csvText,
        "text/csv;charset=utf-8"
      );
      showToast("Matriz exportada en formato CSV.");
    });

    // Delegación de eventos en la tabla de matriz
    const tableEl = document.getElementById("decision-matrix-table");

    tableEl.addEventListener("input", (e) => {
      const target = e.target;
      const action = target.dataset.action;
      if (!action) return;

      if (action === "score-input") {
        const { altId, critId } = target.dataset;
        const val = DecisionMath.clamp(target.value, 1, 10);
        // Sincronizar el control hermano (slider <-> number) inmediatamente
        const rowCell = target.closest(".score-inputs-row");
        if (rowCell) {
          rowCell.querySelectorAll('[data-action="score-input"]').forEach((inp) => {
            if (inp !== target) inp.value = val;
          });
        }
        MatrixStore.updateScore(altId, critId, val);
      } else if (action === "weight-input") {
        const { critId } = target.dataset;
        if (target.value === "") return;
        MatrixStore.updateCriterionWeight(critId, target.value);
      }
    });

    tableEl.addEventListener("change", (e) => {
      const target = e.target;
      const action = target.dataset.action;
      if (!action) return;

      if (action === "rename-alt") {
        MatrixStore.updateAlternativeName(target.dataset.altId, target.value);
      } else if (action === "rename-crit") {
        MatrixStore.updateCriterionName(target.dataset.critId, target.value);
      } else if (action === "weight-input") {
        const clamped = Math.round(DecisionMath.clamp(target.value, 1, 100));
        target.value = clamped;
        MatrixStore.updateCriterionWeight(target.dataset.critId, clamped);
      } else if (action === "score-input") {
        const clamped = Math.round(DecisionMath.clamp(target.value, 1, 10) * 10) / 10;
        const rowCell = target.closest(".score-inputs-row");
        if (rowCell) {
          rowCell.querySelectorAll('[data-action="score-input"]').forEach((inp) => {
            inp.value = clamped;
          });
        }
        MatrixStore.updateScore(target.dataset.altId, target.dataset.critId, clamped);
      }
    });

    tableEl.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === "remove-alt") {
        const res = MatrixStore.removeAlternative(btn.dataset.altId);
        if (!res.ok) showToast(res.message);
      } else if (action === "remove-crit") {
        const res = MatrixStore.removeCriterion(btn.dataset.critId);
        if (!res.ok) showToast(res.message);
      }
    });

    // Alternar visibilidad en leyenda del gráfico de radar
    dom.radarLegend.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="toggle-radar-alt"]');
      if (!btn) return;
      MatrixStore.toggleAlternativeVisibility(btn.dataset.altId);
    });
  }

  function bootstrap() {
    cacheDOM();
    MatrixStore.init();
    MatrixStore.subscribe(renderAll);
    bindEvents();
    renderAll(MatrixStore.getState());
  }

  return { bootstrap };
})();

document.addEventListener("DOMContentLoaded", UIBuilder.bootstrap);
