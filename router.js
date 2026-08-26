    /* Cash Register Report */
    function defaultCashReport() {
      return {
        id: null,
        number: null,
        createdAt: null,
        updatedAt: null,
        createdBy: null,
        updatedBy: null,
        cashier: state.user?.username || "",
        expectedTotal: 0,
        notes: "",
        coins: [
          { value: 1, qty: 0 },
          { value: 2, qty: 0 }
        ],
        bills: [
          { value: 5, qty: 0 },
          { value: 10, qty: 0 },
          { value: 20, qty: 0 },
          { value: 50, qty: 0 },
          { value: 100, qty: 0 },
          { value: 200, qty: 0 }
        ],
        withdrawals: []
      };
    }

    function ensureCashReportState() {
      if (!state.cashReport) state.cashReport = defaultCashReport();
    }

    function cloneCashReport(report) {
      return JSON.parse(JSON.stringify(report));
    }

    function cashReportCalc(report) {
      const coinsTotal = report.coins.reduce(
        (sum, row) => sum + row.value * (Number(row.qty) || 0),
        0
      );

      const billsTotal = report.bills.reduce(
        (sum, row) => sum + row.value * (Number(row.qty) || 0),
        0
      );

      const drawerTotal = coinsTotal + billsTotal;

      const withdrawalsTotal = report.withdrawals.reduce(
        (sum, row) => sum + (Number(row.amount) || 0),
        0
      );

      const reportedTotal = drawerTotal - withdrawalsTotal;
      const difference = reportedTotal - (Number(report.expectedTotal) || 0);

      return {
        coinsTotal,
        billsTotal,
        drawerTotal,
        withdrawalsTotal,
        reportedTotal,
        difference
      };
    }

    function updateCashSummary() {
      const calc = cashReportCalc(state.cashReport);

      const set = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = formatMoney(value);
      };

      set("cashCoinsTotal", calc.coinsTotal);
      set("cashBillsTotal", calc.billsTotal);
      set("cashDrawerTotal", calc.drawerTotal);
      set("cashWithdrawalsTotal", calc.withdrawalsTotal);
      set("cashReportedTotal", calc.reportedTotal);
      set("cashDifference", calc.difference);

      const row = document.getElementById("cashDifferenceRow");
      if (row) {
        row.classList.toggle("positive", calc.difference >= 0);
        row.classList.toggle("negative", calc.difference < 0);
      }
    }

    function renderCashReport() {
      ensureCashReportState();

      const report = state.cashReport;
      const calc = cashReportCalc(report);
      const theme = db.settings.cashReportTheme || "gold";
      const when = new Date(report.updatedAt || report.createdAt || Date.now());

      const dateOnly = new Intl.DateTimeFormat(state.lang === "sq" ? "sq-AL" : "en-GB", {
        dateStyle: "long"
      }).format(when);

      const timeOnly = formatTime(when);
      const content = $("#adminContent");

      const themes = ["gold", "emerald", "blue", "purple", "rose"];

      content.innerHTML = `
        <div class="cash-report theme-${esc(theme)}">
          <div class="admin-topbar">
            <div>
              <h2>${esc(t("cash.title"))}</h2>
              <div class="text-muted">${esc(t("cash.subtitle"))}</div>
            </div>

            <div class="right">
              <select id="cashThemeSelect" class="select-field cash-theme-select" aria-label="${esc(t("cash.theme"))}">
                ${themes
                  .map(
                    (value) => `
                      <option value="${value}" ${theme === value ? "selected" : ""}>
                        ${esc(t(`cash.theme.${value}`))}
                      </option>
                    `
                  )
                  .join("")}
              </select>

              <button class="btn btn-gold" data-cash-action="save">${esc(t("cash.save"))}</button>
              <button class="btn btn-dark" data-cash-action="new">${esc(t("cash.new"))}</button>
              <button class="btn btn-ghost" data-cash-action="history">${esc(t("cash.history"))}</button>
              <button class="btn btn-ghost" data-cash-action="print">${esc(t("cash.print"))}</button>
              <button class="btn btn-dark" data-cash-action="sample">${esc(t("cash.sample"))}</button>
            </div>
          </div>

          <div id="cashReportPrintArea" class="print-area stack">
            <div class="panel">
              <div class="cash-meta">
                <div><strong>${esc(db.settings.restaurantName)}</strong></div>
                ${
                  report.number
                    ? `<div><span class="cash-badge">${esc(t("cash.report_number"))}:</span> <strong>${esc(report.number)}</strong></div>`
                    : ""
                }
                <div><span class="cash-badge">${esc(t("cash.calculated_by"))}:</span> <strong>${esc(report.createdBy || state.user?.username || "")}</strong></div>
                <div><span class="cash-badge">${esc(t("cash.updated_by"))}:</span> <strong>${esc(report.updatedBy || state.user?.username || "")}</strong></div>
              </div>

              <div class="form-grid two-col">
                <div class="field">
                  <label>${esc(t("cash.date"))}</label>
                  <input class="input" readonly value="${esc(dateOnly)}" />
                </div>

                <div class="field">
                  <label>${esc(t("cash.time"))}</label>
                  <input class="input" readonly value="${esc(timeOnly)}" />
                </div>

                <div class="field">
                  <label>${esc(t("cash.cashier"))}</label>
                  <input id="cashCashier" class="input" value="${esc(report.cashier)}" />
                </div>

                <div class="field">
                  <label>${esc(t("cash.expected_total"))}</label>
                  <input id="cashExpected" class="input" type="number" step="0.01" min="0" value="${esc(report.expectedTotal)}" />
                </div>

                <div class="field span-2">
                  <label>${esc(t("cash.notes"))}</label>
                  <textarea id="cashNotes" class="textarea">${esc(report.notes)}</textarea>
                </div>
              </div>
            </div>

            <div class="cash-grid">
              <div class="panel">
                <h3>${esc(t("cash.coins"))}</h3>
                <div class="table-wrap">
                  <table class="table cash-table">
                    <thead>
                      <tr>
                        <th>${esc(t("cash.value"))}</th>
                        <th>${esc(t("cash.qty"))}</th>
                        <th>${esc(t("cash.total"))}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${report.coins
                        .map(
                          (row, index) => `
                            <tr>
                              <td>${formatMoney(row.value)}</td>
                              <td>
                                <input
                                  class="input cash-qty"
                                  data-kind="coins"
                                  data-index="${index}"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value="${esc(row.qty)}"
                                />
                              </td>
                              <td data-row-total="coins-${index}">
                                ${formatMoney(row.value * (Number(row.qty) || 0))}
                              </td>
                            </tr>
                          `
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>

              <div class="panel">
                <h3>${esc(t("cash.bills"))}</h3>
                <div class="table-wrap">
                  <table class="table cash-table">
                    <thead>
                      <tr>
                        <th>${esc(t("cash.value"))}</th>
                        <th>${esc(t("cash.qty"))}</th>
                        <th>${esc(t("cash.total"))}</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${report.bills
                        .map(
                          (row, index) => `
                            <tr>
                              <td>${formatMoney(row.value)}</td>
                              <td>
                                <input
                                  class="input cash-qty"
                                  data-kind="bills"
                                  data-index="${index}"
                                  type="number"
                                  min="0"
                                  step="1"
                                  value="${esc(row.qty)}"
                                />
                              </td>
                              <td data-row-total="bills-${index}">
                                ${formatMoney(row.value * (Number(row.qty) || 0))}
                              </td>
                            </tr>
                          `
                        )
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <div class="panel">
              <div class="split">
                <h3>${esc(t("cash.withdrawals"))}</h3>
                <button id="cashAddWithdrawal" class="btn btn-dark">${esc(t("cash.add_withdrawal"))}</button>
              </div>

              <div class="cash-withdrawals">
                ${
                  report.withdrawals.length
                    ? report.withdrawals
                        .map(
                          (row, index) => `
                            <div class="cash-withdrawal">
                              <input
                                class="input"
                                data-withdrawal-field="person"
                                data-index="${index}"
                                value="${esc(row.person)}"
                                placeholder="${esc(t("cash.person"))}"
                              />
                              <input
                                class="input"
                                data-withdrawal-field="amount"
                                data-index="${index}"
                                type="number"
                                step="0.01"
                                min="0"
                                value="${esc(row.amount)}"
                                placeholder="${esc(t("cash.amount"))}"
                              />
                              <input
                                class="input"
                                data-withdrawal-field="note"
                                data-index="${index}"
                                value="${esc(row.note)}"
                                placeholder="${esc(t("cash.note"))}"
                              />
                              <button class="danger-icon" data-withdrawal-remove="${index}" aria-label="${esc(t("cash.remove"))}">✕</button>
                            </div>
                          `
                        )
                        .join("")
                    : `<p class="text-muted">${esc(t("admin.no_data"))}</p>`
                }
              </div>
            </div>

            <div class="panel">
              <h3>${esc(t("cash.summary"))}</h3>

              <div class="cash-summary">
                <div class="cash-summary-row">
                  <span>${esc(t("cash.coins_summary"))}</span>
                  <strong id="cashCoinsTotal">${formatMoney(calc.coinsTotal)}</strong>
                </div>

                <div class="cash-summary-row">
                  <span>${esc(t("cash.bills_summary"))}</span>
                  <strong id="cashBillsTotal">${formatMoney(calc.billsTotal)}</strong>
                </div>

                <div class="cash-summary-row">
                  <span>${esc(t("cash.drawer_total"))}</span>
                  <strong id="cashDrawerTotal">${formatMoney(calc.drawerTotal)}</strong>
                </div>

                <div class="cash-summary-row">
                  <span>${esc(t("cash.withdrawals_total"))}</span>
                  <strong id="cashWithdrawalsTotal">${formatMoney(calc.withdrawalsTotal)}</strong>
                </div>

                <div class="cash-summary-row final">
                  <span>${esc(t("cash.reported_total"))}</span>
                  <strong id="cashReportedTotal">${formatMoney(calc.reportedTotal)}</strong>
                </div>

                <div id="cashDifferenceRow" class="cash-summary-row final ${calc.difference >= 0 ? "positive" : "negative"}">
                  <span>${esc(t("cash.difference"))}</span>
                  <strong id="cashDifference">${formatMoney(calc.difference)}</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      `;

      bindCashReportEvents();
    }

    function bindCashReportEvents() {
      const content = $("#adminContent");

      $("#cashCashier", content).addEventListener("input", (event) => {
        state.cashReport.cashier = event.target.value;
      });

      $("#cashExpected", content).addEventListener("input", (event) => {
        state.cashReport.expectedTotal = Number(event.target.value) || 0;
        updateCashSummary();
      });

      $("#cashNotes", content).addEventListener("input", (event) => {
        state.cashReport.notes = event.target.value;
      });

      $$(".cash-qty", content).forEach((input) => {
        input.addEventListener("input", (event) => {
          const kind = event.target.dataset.kind;
          const index = Number(event.target.dataset.index);

          state.cashReport[kind][index].qty = Math.max(0, Number(event.target.value) || 0);

          const rowTotal =
            state.cashReport[kind][index].value * state.cashReport[kind][index].qty;

          const rowTotalEl = $(`[data-row-total="${kind}-${index}"]`, content);
          if (rowTotalEl) rowTotalEl.textContent = formatMoney(rowTotal);

          updateCashSummary();
        });
      });

      $$("[data-withdrawal-field]", content).forEach((input) => {
        input.addEventListener("input", (event) => {
          const index = Number(event.target.dataset.index);
          const field = event.target.dataset.withdrawalField;

          state.cashReport.withdrawals[index][field] =
            field === "amount" ? Number(event.target.value) || 0 : event.target.value;

          updateCashSummary();
        });
      });

      $$("[data-withdrawal-remove]", content).forEach((button) => {
        button.addEventListener("click", () => {
          state.cashReport.withdrawals.splice(Number(button.dataset.withdrawalRemove), 1);
          renderCashReport();
        });
      });

      $("#cashAddWithdrawal", content).addEventListener("click", () => {
        state.cashReport.withdrawals.push({
          person: "",
          amount: 0,
          note: ""
        });

        renderCashReport();
      });

      $("#cashThemeSelect", content).addEventListener("change", (event) => {
        db.settings.cashReportTheme = event.target.value;
        saveDB();
        logActivity(`Cash report theme changed to ${event.target.value}`);
        renderCashReport();
      });

      $$("[data-cash-action]", content).forEach((button) => {
        button.addEventListener("click", () => {
          handleCashAction(button.dataset.cashAction);
        });
      });
    }

    function handleCashAction(action) {
      if (action === "save") return saveCashReport();

      if (action === "new") {
        state.cashReport = defaultCashReport();
        renderCashReport();
        return;
      }

      if (action === "history") return openCashHistoryModal();

      if (action === "print") {
        window.print();
        return;
      }

      if (action === "sample") {
        state.cashReport = sampleCashReport();
        renderCashReport();
      }
    }

    function sampleCashReport() {
      const report = defaultCashReport();

      report.cashier = state.user?.username || "Cashier";
      report.expectedTotal = 320.5;
      report.notes = state.lang === "sq" ? "Shembull demonstrimi." : "Sample demonstration.";

      report.coins[0].qty = 25;
      report.coins[1].qty = 12;

      report.bills[0].qty = 10;
      report.bills[1].qty = 8;
      report.bills[2].qty = 5;
      report.bills[3].qty = 2;
      report.bills[4].qty = 1;
      report.bills[5].qty = 0;

      report.withdrawals = [
        {
          person: state.lang === "sq" ? "Menaxheri" : "Manager",
          amount: 50,
          note: state.lang === "sq" ? "Blerje operative" : "Operational purchase"
        },
        {
          person: state.lang === "sq" ? "Furnizuesi" : "Supplier",
          amount: 80,
          note: state.lang === "sq" ? "Pagesë furnizimi" : "Supplier payment"
        }
      ];

      return report;
    }

    function saveCashReport() {
      ensureCashReportState();

      const report = state.cashReport;

      if (!report.cashier.trim()) {
        toast(t("cash.fill_cashier"), "error");
        return;
      }

      const user = state.user?.username || "admin";
      const nowISO = new Date().toISOString();

      report.updatedAt = nowISO;
      report.updatedBy = user;

      if (!report.id) {
        report.id = uuid();
        report.createdAt = nowISO;
        report.createdBy = user;

        db.counters.cashReports = (db.counters.cashReports || 0) + 1;

        const now = new Date();
        report.number = `ARK-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
          now.getDate()
        ).padStart(2, "0")}-${String(db.counters.cashReports).padStart(3, "0")}`;

        db.cashReports.unshift(cloneCashReport(report));
      } else {
        const index = db.cashReports.findIndex((item) => item.id === report.id);

        if (index >= 0) {
          db.cashReports[index] = cloneCashReport(report);
        } else {
          db.cashReports.unshift(cloneCashReport(report));
        }
      }

      saveDB();
      logActivity(`Cash report ${report.number} saved by ${user}`);
      toast(t("cash.saved"), "success");
      renderCashReport();
    }

    function openCashHistoryModal() {
      const reports = db.cashReports
        .slice()
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0) -
            new Date(a.updatedAt || a.createdAt || 0)
        );

      const rows = reports.length
        ? reports
            .map((report) => {
              const calc = cashReportCalc(report);

              return `
                <tr>
                  <td><strong>${esc(report.number || "")}</strong></td>
                  <td>${esc(formatDate(report.updatedAt || report.createdAt))}</td>
                  <td>${esc(report.cashier)}</td>
                  <td>
                    ${esc(report.createdBy || "")}
                    ${
                      report.updatedBy && report.updatedBy !== report.createdBy
                        ? `<br><span class="text-muted">${esc(report.updatedBy)}</span>`
                        : ""
                    }
                  </td>
                  <td>${formatMoney(report.expectedTotal)}</td>
                  <td>${formatMoney(calc.reportedTotal)}</td>
                  <td>${formatMoney(calc.difference)}</td>
                  <td>
                    <div class="row-actions">
                      <button class="btn btn-dark btn-sm" data-cash-history-action="load" data-cash-history-id="${esc(report.id)}">
                        ${esc(t("cash.load"))}
                      </button>
                      <button class="btn btn-danger btn-sm" data-cash-history-action="delete" data-cash-history-id="${esc(report.id)}">
                        ${esc(t("cash.delete"))}
                      </button>
                    </div>
                  </td>
                </tr>
              `;
            })
            .join("")
        : `<tr><td colspan="8" class="center text-muted">${esc(t("cash.no_history"))}</td></tr>`;

      const overlay = openModal(`
        <div class="modal-header">
          <h3>${esc(t("cash.history_title"))}</h3>
          <button class="icon-btn" data-close aria-label="${esc(t("common.close"))}">✕</button>
        </div>

        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>${esc(t("cash.report_number"))}</th>
                <th>${esc(t("admin.date"))}</th>
                <th>${esc(t("cash.cashier"))}</th>
                <th>${esc(t("cash.calculated_by"))}</th>
                <th>${esc(t("cash.expected_total"))}</th>
                <th>${esc(t("cash.reported_total"))}</th>
                <th>${esc(t("cash.difference"))}</th>
                <th>${esc(t("admin.actions"))}</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>
      `);

      $$("[data-cash-history-action]", overlay).forEach((button) => {
        button.addEventListener("click", () => {
          const id = button.dataset.cashHistoryId;
          const action = button.dataset.cashHistoryAction;

          if (action === "load") {
            const report = db.cashReports.find((item) => item.id === id);
            if (!report) return;

            state.cashReport = cloneCashReport(report);
            closeModal(overlay);
            renderCashReport();
          }

          if (action === "delete") {
            if (!confirm(t("common.confirm_delete"))) return;

            const report = db.cashReports.find((item) => item.id === id);

            db.cashReports = db.cashReports.filter((item) => item.id !== id);

            if (state.cashReport?.id === id) {
              state.cashReport = defaultCashReport();
            }

            saveDB();
            logActivity(`Cash report ${report?.number || id} deleted`);
            closeModal(overlay);
            openCashHistoryModal();
            toast(t("notify.deleted"), "info");
          }
        });
      });
    }