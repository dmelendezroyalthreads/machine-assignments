export type ImportSourceType = "pmstats" | "logistiview" | "generic";

export type ImportedOrder = {
  order_key: string;
  order_number: string;
  customer_name: string;
  units: number;
  category: string;
  due_date: string;
  source_location: string;
  details: Record<string, string>;
};

export type ParsedOrderFile = {
  orders: ImportedOrder[];
  sourceType: ImportSourceType;
};

function normalizeHeader(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function cleanValue(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function findHeader(headers: string[], aliases: string[]) {
  const normalized = headers.map((header) => normalizeHeader(header));
  const index = normalized.findIndex((header) => aliases.includes(header));
  return index >= 0 ? headers[index] : "";
}

export async function parseOrderFile(file: File): Promise<ParsedOrderFile> {
  const XLSX = await import("xlsx");
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) throw new Error("The file does not contain a worksheet.");

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[firstSheetName], {
    defval: "",
    raw: false,
  });
  if (rows.length === 0) throw new Error("The file does not contain order rows.");

  const headers = Object.keys(rows[0]);
  const pickHeader = findHeader(headers, ["picknum", "pickticket", "picknumber", "pick"]);
  const unitsHeader = findHeader(headers, ["stdskuqty", "unitqty", "units", "quantity", "qty"]);
  if (!pickHeader || !unitsHeader) {
    throw new Error("Could not identify the pick ticket and units columns.");
  }

  const orderHeader = findHeader(headers, ["ordernum", "ordernumber", "order"]);
  const customerHeader = findHeader(headers, ["customername", "custname", "customer", "custid"]);
  const categoryHeader = findHeader(headers, ["rushevent", "category"]);
  const dueHeader = findHeader(headers, ["shipdate", "requestdate", "startdate", "duedate"]);
  const locationHeader = findHeader(headers, ["locationid", "location"]);

  const normalizedHeaders = headers.map((header) => normalizeHeader(header));
  const sourceType: ImportSourceType = normalizedHeaders.includes("stdskuqty")
    ? "pmstats"
    : normalizedHeaders.includes("unitqty") && normalizedHeaders.includes("pickticket")
      ? "logistiview"
      : "generic";

  const grouped = new Map<string, ImportedOrder>();
  for (const row of rows) {
    const orderKey = cleanValue(row[pickHeader]);
    if (!orderKey) continue;

    const rawUnits = cleanValue(row[unitsHeader]).replace(/,/g, "");
    const units = Math.max(0, Math.round(Number(rawUnits) || 0));
    const details = Object.fromEntries(
      headers
        .map((header) => [header, cleanValue(row[header])] as const)
        .filter(([, value]) => value !== "")
    );

    const existing = grouped.get(orderKey);
    if (existing) {
      existing.units += units;
      continue;
    }

    grouped.set(orderKey, {
      order_key: orderKey,
      order_number: orderHeader ? cleanValue(row[orderHeader]) : "",
      customer_name: customerHeader ? cleanValue(row[customerHeader]) : "",
      units,
      category: categoryHeader ? cleanValue(row[categoryHeader]) : "",
      due_date: dueHeader ? cleanValue(row[dueHeader]) : "",
      source_location: locationHeader ? cleanValue(row[locationHeader]) : "",
      details,
    });
  }

  const orders = [...grouped.values()].sort((a, b) =>
    a.order_key.localeCompare(b.order_key, undefined, { numeric: true })
  );
  if (orders.length === 0) throw new Error("No pick tickets were found in the file.");
  return { orders, sourceType };
}
