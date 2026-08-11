(() => {
  "use strict";

  const STORAGE_KEY = "diet-weight-tracker-v1";
  const RULES = {
    solid: { label: "固体", factor: 1, symbol: "●" },
    liquid: { label: "液体", factor: 0.1, symbol: "◒" },
    nuts: { label: "坚果", factor: 3, symbol: "◆" },
    soft: { label: "酸奶 / 粥", factor: 0.3, symbol: "◉" },
    produce: { label: "水果 / 蔬菜", factor: 0.5, symbol: "✦" }
  };
  const PLAN_TYPES = new Set(["solid", "liquid", "soft"]);
  const SOFT_KEYWORDS = ["酸奶", "酸乳", "发酵乳", "粥", "稀饭", "米糊", "芝麻糊", "藕粉"];
  const LIQUID_KEYWORDS = ["牛奶", "豆浆", "果汁", "咖啡", "奶茶", "饮料", "饮品", "可乐", "气泡水", "矿泉水"];

  const el = (id) => document.getElementById(id);
  const todayString = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };
  const parseDate = (dateString) => new Date(`${dateString}T12:00:00`);
  const roundWeight = (value) => Math.round((Number(value) + Number.EPSILON) * 10) / 10;
  const formatWeight = (value) => {
    const rounded = roundWeight(value);
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  };

  let state = loadState();
  let currentDate = todayString();
  let planDate = todayString();
  let selectedType = "solid";
  let editingId = null;
  let shellMode = false;
  let deferredInstallPrompt = null;
  let toastTimer = null;

  function loadState() {
    const fallback = { limit: 650, records: [], plans: [] };
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || !Array.isArray(parsed.records)) return fallback;
      const limit = Number(parsed.limit);
      return {
        limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 9999) : 650,
        records: parsed.records
          .filter((record) => record && RULES[record.type] && Number(record.actual) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(record.date))
          .map((record) => {
            const actual = roundWeight(record.actual);
            const hasShell = Boolean(record.hasShell);
            const shellValue = Number(record.shell);
            const shell = hasShell && Number.isFinite(shellValue) && shellValue > 0 && shellValue < actual
              ? roundWeight(shellValue)
              : null;
            return {
              id: String(record.id || `${Date.now()}-${Math.random()}`),
              date: record.date,
              name: String(record.name || "").slice(0, 30),
              type: record.type,
              actual,
              hasShell,
              shell,
              createdAt: Number(record.createdAt) || Date.now()
            };
          }),
        plans: (Array.isArray(parsed.plans) ? parsed.plans : [])
          .filter((plan) => plan && /^\d{4}-\d{2}-\d{2}$/.test(plan.date) && String(plan.food || "").trim() && Number(plan.grams) > 0)
          .map((plan) => {
            const food = String(plan.food).trim().slice(0, 30);
            return {
              id: String(plan.id || `${Date.now()}-${Math.random()}`),
              date: plan.date,
              food,
              type: PLAN_TYPES.has(plan.type) ? plan.type : inferPlanType(food),
              grams: roundWeight(Math.min(Number(plan.grams), 9999)),
              completed: Boolean(plan.completed),
              completedAt: plan.completed && Number(plan.completedAt) ? Number(plan.completedAt) : null,
              createdAt: Number(plan.createdAt) || Date.now()
            };
          })
      };
    } catch {
      return fallback;
    }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function netWeight(record) {
    return roundWeight(Math.max(0, record.actual - (record.hasShell && record.shell ? record.shell : 0)));
  }

  function effectiveWeight(record) {
    return roundWeight(netWeight(record) * RULES[record.type].factor);
  }

  function recordsFor(date) {
    return state.records
      .filter((record) => record.date === date)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  function totalsFor(date) {
    const records = recordsFor(date);
    return {
      records,
      actual: roundWeight(records.reduce((sum, record) => sum + netWeight(record), 0)),
      effective: roundWeight(records.reduce((sum, record) => sum + effectiveWeight(record), 0))
    };
  }

  function plansFor(date) {
    return state.plans
      .filter((plan) => plan.date === date)
      .sort((a, b) => Number(a.completed) - Number(b.completed) || a.createdAt - b.createdAt);
  }

  function formatDateHeading(dateString) {
    const date = parseDate(dateString);
    const today = todayString();
    const yesterday = new Date(parseDate(today));
    yesterday.setDate(yesterday.getDate() - 1);
    let primary = `${date.getMonth() + 1}月${date.getDate()}日`;
    if (dateString === today) primary = "今天";
    if (dateString === toDateString(yesterday)) primary = "昨天";
    const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
    return { primary, secondary: `${date.getFullYear()}年 · ${weekdays[date.getDay()]}` };
  }

  function toDateString(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function renderAll() {
    renderDate();
    renderPlanDate();
    renderProgress();
    renderRecords();
    renderHistory();
    renderPlans();
    updatePlanTypePreview();
    el("dailyLimit").value = String(state.limit);
  }

  function renderDate() {
    const label = formatDateHeading(currentDate);
    el("datePrimary").textContent = label.primary;
    el("dateSecondary").textContent = label.secondary;
    el("dateInput").value = currentDate;
    el("dateInput").max = todayString();
    el("nextDayButton").disabled = currentDate >= todayString();
  }

  function renderPlanDate() {
    const label = formatDateHeading(planDate);
    el("planDatePrimary").textContent = label.primary;
    el("planDateSecondary").textContent = label.secondary;
    el("planDateInput").value = planDate;
  }

  function renderProgress() {
    const { effective } = totalsFor(currentDate);
    const remaining = roundWeight(state.limit - effective);
    const percent = state.limit ? Math.round((effective / state.limit) * 100) : 0;
    const angle = Math.min(percent, 100) * 3.6;
    el("usedWeight").textContent = formatWeight(effective);
    el("limitLabel").textContent = `上限 ${formatWeight(state.limit)}g`;
    el("progressPercent").textContent = `${percent}%`;
    el("progressRing").style.setProperty("--progress", `${angle}deg`);
    el("progressRing").setAttribute("aria-label", `已计入 ${formatWeight(effective)} 克，占每日上限的 ${percent}%`);
    const isOver = remaining < 0;
    el("progressCard").classList.toggle("over", isOver);
    el("remainingText").textContent = isOver
      ? `已超出 ${formatWeight(Math.abs(remaining))} 克`
      : `还可以计入 ${formatWeight(remaining)} 克`;
  }

  function renderRecords() {
    const { records, actual } = totalsFor(currentDate);
    const pendingShellCount = records.filter((record) => record.hasShell && !record.shell).length;
    el("recordsTitle").textContent = `${records.length} 条记录`;
    el("actualTotal").textContent = pendingShellCount
      ? `净重暂计 ${formatWeight(actual)} 克`
      : `净重共 ${formatWeight(actual)} 克`;
    el("recordsEmpty").classList.toggle("hidden", records.length > 0);
    el("recordsList").innerHTML = records.map((record) => {
      const rule = RULES[record.type];
      const safeName = escapeHTML(record.name || rule.label);
      const time = new Date(record.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      const pendingShell = record.hasShell && !record.shell;
      const net = netWeight(record);
      const detail = record.hasShell
        ? (pendingShell
          ? `${rule.label} · 带壳 ${formatWeight(record.actual)}g · 待补壳重 · ${time}`
          : `${rule.label} · 带壳 ${formatWeight(record.actual)}g - 壳 ${formatWeight(record.shell)}g = 净重 ${formatWeight(net)}g · ${time}`)
        : `${rule.label} · 净重 ${formatWeight(net)}g · ${time}`;
      return `
        <article class="record-item">
          <div class="record-icon" aria-hidden="true">${rule.symbol}</div>
          <div class="record-copy">
            <strong>${safeName}</strong>
            <span>${detail}</span>
          </div>
          <div class="record-weight"><strong>${formatWeight(effectiveWeight(record))}g</strong><span>${pendingShell ? "暂计重量" : "计入重量"}</span></div>
          <div class="record-actions">
            ${record.hasShell ? `<button class="mini-button shell-action" type="button" data-action="shell" data-id="${escapeHTML(record.id)}">${pendingShell ? "补壳重" : "改壳重"}</button>` : ""}
            <button class="mini-button" type="button" data-action="edit" data-id="${escapeHTML(record.id)}">修改</button>
            <button class="mini-button delete" type="button" data-action="delete" data-id="${escapeHTML(record.id)}">删除</button>
          </div>
        </article>`;
    }).join("");
  }

  function renderHistory() {
    const days = [];
    const today = parseDate(todayString());
    for (let i = 0; i < 14; i += 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - i);
      const dateString = toDateString(date);
      const totals = totalsFor(dateString);
      days.push({ date, dateString, ...totals });
    }
    const recorded = days.filter((day) => day.records.length > 0);
    const average = recorded.length ? recorded.reduce((sum, day) => sum + day.effective, 0) / recorded.length : 0;
    const within = recorded.filter((day) => day.effective <= state.limit).length;
    el("recordedDays").textContent = `${recorded.length} 天`;
    el("averageWeight").textContent = `${formatWeight(average)} 克`;
    el("withinLimitDays").textContent = `${within} 天`;
    el("historyList").innerHTML = days.map((day) => {
      const heading = formatDateHeading(day.dateString);
      const percent = state.limit ? Math.min(100, Math.round((day.effective / state.limit) * 100)) : 0;
      const over = day.effective > state.limit;
      return `
        <button class="history-item${over ? " over" : ""}" type="button" data-date="${day.dateString}" style="--bar:${percent}%">
          <span class="history-item-top">
            <span class="history-date"><strong>${heading.primary}</strong><span>${heading.secondary} · ${day.records.length} 条</span></span>
            <span class="history-value"><strong>${formatWeight(day.effective)} 克</strong><span>${over ? `超出 ${formatWeight(day.effective - state.limit)} 克` : `剩余 ${formatWeight(state.limit - day.effective)} 克`}</span></span>
          </span>
          <span class="history-bar"><span></span></span>
        </button>`;
    }).join("");
  }

  function renderPlans() {
    const plans = plansFor(planDate);
    const completed = plans.filter((plan) => plan.completed);
    const totalGrams = roundWeight(plans.reduce((sum, plan) => sum + plan.grams, 0));
    const completedGrams = roundWeight(completed.reduce((sum, plan) => sum + plan.grams, 0));
    const percent = plans.length ? Math.round((completed.length / plans.length) * 100) : 0;

    el("planDoneCount").textContent = String(completed.length);
    el("planTotalCount").textContent = `/ ${plans.length} 项`;
    el("planGramSummary").textContent = `已打卡 ${formatWeight(completedGrams)} / ${formatWeight(totalGrams)} 克`;
    el("planPercent").textContent = `${percent}%`;
    el("planPercent").setAttribute("aria-label", `计划完成 ${percent}%`);
    el("planListTitle").textContent = `${plans.length} 项计划`;
    el("planListStatus").textContent = plans.length ? `已完成 ${completed.length} 项` : "还没有安排";
    el("planEmpty").classList.toggle("hidden", plans.length > 0);
    el("planList").innerHTML = plans.map((plan) => {
      const safeFood = escapeHTML(plan.food);
      const planType = PLAN_TYPES.has(plan.type) ? plan.type : inferPlanType(plan.food);
      const typeRule = RULES[planType];
      const completedTime = plan.completedAt
        ? new Date(plan.completedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false })
        : "";
      return `
        <article class="plan-item${plan.completed ? " completed" : ""}">
          <button class="plan-check-button" type="button" data-plan-action="toggle" data-id="${escapeHTML(plan.id)}" aria-pressed="${plan.completed}" aria-label="${plan.completed ? "取消打卡" : "打卡"} ${safeFood} ${formatWeight(plan.grams)}克">${plan.completed ? "✓" : "○"}</button>
          <div class="plan-item-copy">
            <strong>${safeFood}</strong>
            <span>${typeRule.symbol} ${typeRule.label} · ${plan.completed ? `已打卡 · ${completedTime}` : "等待打卡"}</span>
          </div>
          <div class="plan-item-actions">
            <strong>${formatWeight(plan.grams)}g</strong>
            <button class="plan-delete-button" type="button" data-plan-action="delete" data-id="${escapeHTML(plan.id)}" aria-label="删除计划 ${safeFood}">删除</button>
          </div>
        </article>`;
    }).join("");
  }

  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", "\"": "&quot;" })[character]);
  }

  function inferPlanType(food) {
    const normalized = String(food || "").replace(/\s+/g, "").toLowerCase();
    if (SOFT_KEYWORDS.some((keyword) => normalized.includes(keyword))) return "soft";
    if (
      LIQUID_KEYWORDS.some((keyword) => normalized.includes(keyword))
      || normalized === "水"
      || normalized.endsWith("水")
      || normalized.endsWith("汤")
      || normalized.endsWith("茶")
      || normalized.endsWith("酒")
    ) return "liquid";
    return "solid";
  }

  function updatePlanTypePreview() {
    const food = el("planFood").value.trim();
    if (!food) {
      el("planDetectedType").textContent = "填写食物后显示";
      return;
    }
    const rule = RULES[inferPlanType(food)];
    el("planDetectedType").textContent = `${rule.symbol} ${rule.label}`;
  }

  function updatePreview() {
    const actual = Number(el("actualWeight").value) || 0;
    const shell = shellMode ? (Number(el("shellWeight").value) || 0) : 0;
    const net = Math.max(0, actual - shell);
    if (shellMode && shell > 0) {
      el("calculationLabel").textContent = `净重 ${formatWeight(net)} 克 · 本次计入`;
    } else if (shellMode) {
      el("calculationLabel").textContent = "待补壳重 · 暂时计入";
    } else {
      el("calculationLabel").textContent = "本次计入";
    }
    el("calculatedWeight").textContent = `${formatWeight(net * RULES[selectedType].factor)} 克`;
  }

  function setShellMode(enabled) {
    shellMode = Boolean(enabled);
    el("shellToggle").classList.toggle("selected", shellMode);
    el("shellToggle").setAttribute("aria-pressed", String(shellMode));
    el("shellToggleState").textContent = shellMode ? "已开启" : "未开启";
    el("shellFields").classList.toggle("hidden", !shellMode);
    el("shellWeight").disabled = !shellMode;
    el("actualWeightLabel").textContent = shellMode ? "带壳重量" : "实际重量";
    if (!shellMode) el("shellWeight").value = "";
    updatePreview();
  }

  function selectType(type) {
    if (!RULES[type]) return;
    selectedType = type;
    document.querySelectorAll(".type-option").forEach((button) => button.classList.toggle("selected", button.dataset.type === type));
    updatePreview();
  }

  function submitEntry(event) {
    event.preventDefault();
    const actual = Number(el("actualWeight").value);
    if (!Number.isFinite(actual) || actual <= 0) {
      el("formMessage").textContent = "请输入大于 0 的实际重量。";
      el("actualWeight").focus();
      return;
    }
    if (actual > 9999) {
      el("formMessage").textContent = "单条记录最多 9999 克，请检查输入。";
      return;
    }
    const shellInput = el("shellWeight").value.trim();
    const shell = shellMode && shellInput ? Number(shellInput) : null;
    if (shellMode && shell !== null && (!Number.isFinite(shell) || shell <= 0 || shell >= actual)) {
      el("formMessage").textContent = "壳的重量必须大于 0，并且小于带壳重量。";
      el("shellWeight").focus();
      return;
    }
    if (editingId) {
      const record = state.records.find((item) => item.id === editingId);
      if (record) {
        record.actual = roundWeight(actual);
        record.type = selectedType;
        record.hasShell = shellMode;
        record.shell = shellMode && shell !== null ? roundWeight(shell) : null;
      }
      showToast(shellMode && shell !== null ? "壳重已保存，净重已重算" : "记录已修改");
    } else {
      state.records.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        date: currentDate,
        name: "",
        type: selectedType,
        actual: roundWeight(actual),
        hasShell: shellMode,
        shell: shellMode && shell !== null ? roundWeight(shell) : null,
        createdAt: Date.now()
      });
      showToast(shellMode && shell === null ? "已记录带壳重量，吃完后补壳重" : "已记下，继续保持");
    }
    saveState();
    resetForm();
    renderAll();
  }

  function resetForm() {
    editingId = null;
    el("entryForm").reset();
    el("formMessage").textContent = "";
    el("formTitle").textContent = "记录本次重量";
    el("saveEntryButton").textContent = "记下这餐";
    el("cancelEditButton").classList.add("hidden");
    setShellMode(false);
    selectType("solid");
  }

  function editRecord(id, focusShell = false) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    editingId = record.id;
    el("actualWeight").value = String(record.actual);
    setShellMode(record.hasShell);
    el("shellWeight").value = record.shell ? String(record.shell) : "";
    el("formTitle").textContent = focusShell ? "补录壳的重量" : "修改这条记录";
    el("saveEntryButton").textContent = focusShell ? "保存并计算净重" : "保存修改";
    el("cancelEditButton").classList.remove("hidden");
    selectType(record.type);
    updatePreview();
    (focusShell ? el("shellWeight") : el("actualWeight")).focus();
    window.scrollTo({ top: el("entryForm").getBoundingClientRect().top + window.scrollY - 90, behavior: "smooth" });
  }

  function deleteRecord(id) {
    const record = state.records.find((item) => item.id === id);
    if (!record) return;
    if (!window.confirm(`确定删除“${record.name || RULES[record.type].label}”这条记录吗？`)) return;
    state.records = state.records.filter((item) => item.id !== id);
    if (editingId === id) resetForm();
    saveState();
    renderAll();
    showToast("记录已删除");
  }

  function submitPlan(event) {
    event.preventDefault();
    const food = el("planFood").value.trim();
    const grams = Number(el("planWeight").value);
    if (!food) {
      el("planFormMessage").textContent = "请输入计划食物。";
      el("planFood").focus();
      return;
    }
    if (!Number.isFinite(grams) || grams <= 0 || grams > 9999) {
      el("planFormMessage").textContent = "请输入 0.1 到 9999 克之间的计划重量。";
      el("planWeight").focus();
      return;
    }
    state.plans.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      date: planDate,
      food: food.slice(0, 30),
      type: inferPlanType(food),
      grams: roundWeight(grams),
      completed: false,
      completedAt: null,
      createdAt: Date.now()
    });
    saveState();
    el("planForm").reset();
    el("planFormMessage").textContent = "";
    updatePlanTypePreview();
    renderPlans();
    showToast("已加入当天饮食计划");
  }

  function togglePlan(id) {
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) return;
    plan.completed = !plan.completed;
    plan.completedAt = plan.completed ? Date.now() : null;
    saveState();
    renderPlans();
    showToast(plan.completed ? `${plan.food} 已打卡` : `${plan.food} 已取消打卡`);
  }

  function deletePlan(id) {
    const plan = state.plans.find((item) => item.id === id);
    if (!plan) return;
    if (!window.confirm(`确定删除“${plan.food} ${formatWeight(plan.grams)}克”这项计划吗？`)) return;
    state.plans = state.plans.filter((item) => item.id !== id);
    saveState();
    renderPlans();
    showToast("计划已删除");
  }

  function changeDate(offset) {
    const next = parseDate(currentDate);
    next.setDate(next.getDate() + offset);
    const nextString = toDateString(next);
    if (nextString > todayString()) return;
    currentDate = nextString;
    resetForm();
    renderAll();
  }

  function changePlanDate(offset) {
    const next = parseDate(planDate);
    next.setDate(next.getDate() + offset);
    planDate = toDateString(next);
    el("planForm").reset();
    el("planFormMessage").textContent = "";
    updatePlanTypePreview();
    renderPlanDate();
    renderPlans();
  }

  function switchView(target) {
    document.querySelectorAll(".view").forEach((view) => view.classList.toggle("active", view.dataset.view === target));
    document.querySelectorAll(".nav-button").forEach((button) => button.classList.toggle("active", button.dataset.target === target));
    if (target === "history") renderHistory();
    if (target === "plan") {
      renderPlanDate();
      renderPlans();
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function saveLimit() {
    const nextLimit = Number(el("dailyLimit").value);
    if (!Number.isFinite(nextLimit) || nextLimit < 1 || nextLimit > 9999) {
      el("limitSaveMessage").textContent = "请输入 1 到 9999 克之间的上限。";
      return;
    }
    state.limit = roundWeight(nextLimit);
    saveState();
    renderAll();
    el("limitSaveMessage").textContent = `已保存：每日上限 ${formatWeight(state.limit)} 克。`;
    showToast("每日上限已更新");
  }

  function exportData() {
    const payload = { app: "饮食重量记录", version: 4, exportedAt: new Date().toISOString(), data: state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `饮食重量记录备份-${todayString()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    showToast("备份文件已导出");
  }

  async function importData(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      const source = parsed && parsed.data ? parsed.data : parsed;
      if (!source || !Array.isArray(source.records) || !Number.isFinite(Number(source.limit))) throw new Error("invalid");
      if (!window.confirm("导入会覆盖当前设备上的全部饮食记录，确定继续吗？")) return;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
      state = loadState();
      currentDate = todayString();
      planDate = todayString();
      resetForm();
      renderAll();
      showToast("备份已导入");
    } catch {
      showToast("这个备份文件无法识别");
    } finally {
      event.target.value = "";
    }
  }

  function clearData() {
    if (!window.confirm("确定清空全部饮食记录和饮食计划吗？此操作无法撤销，建议先导出备份。")) return;
    state.records = [];
    state.plans = [];
    el("planForm").reset();
    updatePlanTypePreview();
    saveState();
    resetForm();
    renderAll();
    showToast("全部记录已清空");
  }

  function showToast(message) {
    clearTimeout(toastTimer);
    el("toast").textContent = message;
    el("toast").classList.add("show");
    toastTimer = setTimeout(() => el("toast").classList.remove("show"), 1900);
  }

  function bindEvents() {
    el("typeGrid").addEventListener("click", (event) => {
      const button = event.target.closest(".type-option");
      if (button) selectType(button.dataset.type);
    });
    el("actualWeight").addEventListener("input", updatePreview);
    el("shellWeight").addEventListener("input", updatePreview);
    el("shellToggle").addEventListener("click", () => setShellMode(!shellMode));
    el("entryForm").addEventListener("submit", submitEntry);
    el("cancelEditButton").addEventListener("click", resetForm);
    el("recordsList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-action]");
      if (!button) return;
      if (button.dataset.action === "edit") editRecord(button.dataset.id);
      if (button.dataset.action === "shell") editRecord(button.dataset.id, true);
      if (button.dataset.action === "delete") deleteRecord(button.dataset.id);
    });
    el("planForm").addEventListener("submit", submitPlan);
    el("planFood").addEventListener("input", updatePlanTypePreview);
    el("planList").addEventListener("click", (event) => {
      const button = event.target.closest("[data-plan-action]");
      if (!button) return;
      if (button.dataset.planAction === "toggle") togglePlan(button.dataset.id);
      if (button.dataset.planAction === "delete") deletePlan(button.dataset.id);
    });
    el("previousDayButton").addEventListener("click", () => changeDate(-1));
    el("nextDayButton").addEventListener("click", () => changeDate(1));
    el("dateButton").addEventListener("click", () => {
      if (typeof el("dateInput").showPicker === "function") el("dateInput").showPicker();
      else el("dateInput").click();
    });
    el("dateInput").addEventListener("change", (event) => {
      if (event.target.value && event.target.value <= todayString()) {
        currentDate = event.target.value;
        resetForm();
        renderAll();
      }
    });
    el("planPreviousDayButton").addEventListener("click", () => changePlanDate(-1));
    el("planNextDayButton").addEventListener("click", () => changePlanDate(1));
    el("planDateButton").addEventListener("click", () => {
      if (typeof el("planDateInput").showPicker === "function") el("planDateInput").showPicker();
      else el("planDateInput").click();
    });
    el("planDateInput").addEventListener("change", (event) => {
      if (event.target.value) {
        planDate = event.target.value;
        el("planForm").reset();
        el("planFormMessage").textContent = "";
        updatePlanTypePreview();
        renderPlanDate();
        renderPlans();
      }
    });
    document.querySelectorAll(".nav-button").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.target)));
    el("historyList").addEventListener("click", (event) => {
      const item = event.target.closest("[data-date]");
      if (!item) return;
      currentDate = item.dataset.date;
      resetForm();
      renderAll();
      switchView("today");
    });
    el("saveLimitButton").addEventListener("click", saveLimit);
    el("exportButton").addEventListener("click", exportData);
    el("importInput").addEventListener("change", importData);
    el("clearDataButton").addEventListener("click", clearData);
    el("installHelpButton").addEventListener("click", () => switchView("settings"));
    el("installButton").addEventListener("click", async () => {
      if (!deferredInstallPrompt) return;
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      el("installButton").classList.add("hidden");
    });
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      el("installButton").classList.remove("hidden");
    });
  }

  bindEvents();
  setShellMode(false);
  renderAll();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
})();
