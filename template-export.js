(function (scope) {
  "use strict";

  // Update the original OOXML package so its native layout and conditional
  // formatting survive. Report data never leaves the browser.
  const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
  const TYPES = "http://schemas.openxmlformats.org/package/2006/content-types";
  const XML = "http://www.w3.org/XML/1998/namespace";
  const COMMENT_REL = REL + "/comments";
  const VML_REL = REL + "/vmlDrawing";
  const COMMENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml";
  const VML_TYPE = "application/vnd.openxmlformats-officedocument.vmlDrawing";
  const CONFIG = [
    { name: "银河排名", width: 6, last: "F", rankEnd: "D", manager: "E", category: "F", source: "galaxy" },
    { name: "国泰海通排名", width: 11, last: "K", rankEnd: "G", manager: "J", category: "K", source: "gtht" }
  ];

  function cleanText(value) {
    return String(value == null ? "" : value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "");
  }

  function escapeXml(value) {
    return cleanText(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function parseXml(source, path) {
    const doc = new scope.DOMParser().parseFromString(source, "application/xml");
    if (!doc.documentElement || doc.getElementsByTagName("parsererror").length) {
      throw new Error("Excel 模板中的 XML 无法读取：" + path);
    }
    return doc;
  }

  function serializeXml(doc) {
    const result = new scope.XMLSerializer().serializeToString(doc);
    return result.startsWith("<?xml") ? result : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + result;
  }

  function elements(node, localName, ns = MAIN) {
    return Array.from(node.getElementsByTagNameNS(ns, localName));
  }

  function directElements(node, localName) {
    return Array.from(node.childNodes).filter(child => child.nodeType === 1 && (!localName || child.localName === localName));
  }

  function first(node, localName, ns = MAIN) {
    return elements(node, localName, ns)[0] || null;
  }

  function resolvePart(basePath, target) {
    const parts = (target.startsWith("/") ? target.slice(1) : basePath.slice(0, basePath.lastIndexOf("/") + 1) + target).split("/");
    const output = [];
    for (const part of parts) {
      if (part === "..") output.pop();
      else if (part && part !== ".") output.push(part);
    }
    return output.join("/");
  }

  function columnName(index) {
    let value = index;
    let name = "";
    while (value) {
      value--;
      name = String.fromCharCode(65 + value % 26) + name;
      value = Math.floor(value / 26);
    }
    return name;
  }

  function columnNumber(name) {
    return Array.from(name).reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
  }

  function writeCell(doc, row, column, rowNumber, value) {
    const address = column + rowNumber;
    let cell = directElements(row, "c").find(item => item.getAttribute("r").replace(/\d+$/, "") === column);
    if (!cell) {
      cell = doc.createElementNS(MAIN, "c");
      const later = directElements(row, "c").find(item => columnNumber(item.getAttribute("r").replace(/\d+$/, "")) > columnNumber(column));
      if (later) row.insertBefore(cell, later);
      else row.appendChild(cell);
    }
    cell.setAttribute("r", address);
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    const text = cleanText(value);
    if (text === "") {
      cell.removeAttribute("t");
      return;
    }
    cell.setAttribute("t", "inlineStr");
    const inline = doc.createElementNS(MAIN, "is");
    const textNode = doc.createElementNS(MAIN, "t");
    textNode.setAttributeNS(XML, "xml:space", "preserve");
    textNode.appendChild(doc.createTextNode(text));
    inline.appendChild(textNode);
    cell.appendChild(inline);
  }

  function moveRow(row, targetNumber) {
    row.setAttribute("r", String(targetNumber));
    for (const cell of directElements(row, "c")) {
      cell.setAttribute("r", cell.getAttribute("r").replace(/\d+$/, String(targetNumber)));
    }
    return row;
  }

  function readCellText(cell, sharedStrings) {
    if (!cell) return "";
    if (cell.getAttribute("t") === "s") return sharedStrings[Number(first(cell, "v") && first(cell, "v").textContent)] || "";
    if (cell.getAttribute("t") === "inlineStr") return elements(cell, "t").map(node => node.textContent).join("");
    return first(cell, "v") && first(cell, "v").textContent || "";
  }

  function rankText(result) {
    if (!result) return "未上传";
    const value = result.rank == null ? (result.formatted == null ? result.text : result.formatted) : result.rank;
    if (value != null && value !== "") return cleanText(value).replace(/%\s*\(/, "%\n(");
    return result.status === "not_uploaded" || result.status === "未上传" ? "未上传" : "--";
  }

  function noteText(result) {
    if (!result || !/^前\d+%\s*\(\d+\/\d+\)$/.test(rankText(result))) return "";
    const filters = {
      csi_500: '“中证500”', csi_1000: '“中证1000”',
      csi_300: '“沪深300”', csi_a500: '“中证A500”',
      kechuang_composite: '“科创”及“综”',
      zhongzhai_1_3: '“中债”“1-3”“政”',
      zhongzhai_0_3: '“中债0-3”及“政”'
    };
    const notes = [];
    const filter = filters[result.special_group];
    if (filter) notes.push("筛选" + filter + "，手排");
    if (Number(result.tie_count) > 1 || Array.isArray(result.ties) && result.ties.length) notes.push("并列排名");
    return notes.join("；");
  }

  function rowValues(config, product, calculated, categoryLabels) {
    const source = calculated && calculated[config.source] || {};
    const values = { A: product.name || product.code || "", [config.manager]: source.manager || "" };
    let category = source.category || product[config.source + "_category"] || "";
    if (config.source === "galaxy") category = categoryLabels.get(String(category).trim()) || category;
    values[config.category] = category;
    const notes = [];
    function add(column, result) {
      values[column] = rankText(result);
      const text = noteText(result);
      if (text) notes.push({ column, text });
    }
    if (config.source === "galaxy") {
      for (let period = 1; period <= 3; period++) add(columnName(period + 1), (source.ranks || {})[period]);
    } else {
      for (let period = 1; period <= 3; period++) {
        add(columnName(period * 2), (source.performance || {})[period]);
        add(columnName(period * 2 + 1), (source.excess || {})[period]);
      }
      values.H = "";
      values.I = "";
    }
    return { values, notes };
  }

  function patchSheet(doc, config, products, calculatedRows, defaultProducts, sharedStrings) {
    const sheetData = first(doc, "sheetData");
    if (!sheetData) throw new Error("Excel 模板缺少数据区：" + config.name);
    const originalRows = directElements(sheetData, "row");
    const rowByNumber = new Map(originalRows.map(row => [Number(row.getAttribute("r")), row]));
    const originalEnd = defaultProducts.length + 1;
    const originalByCode = new Map(defaultProducts.map((product, index) => [String(product.code), index + 2]));
    const defaultByCode = new Map(defaultProducts.map(product => [String(product.code), product]));
    const categoryLabels = new Map();
    if (config.source === "galaxy") {
      for (const row of originalRows) {
        const categoryCell = directElements(row, "c").find(cell => cell.getAttribute("r").replace(/\d+$/, "") === config.category);
        const label = readCellText(categoryCell, sharedStrings);
        const code = /^\s*(\d+\.\d+\.\d+)/.exec(label);
        if (code) categoryLabels.set(code[1], label);
      }
    }
    const fallback = rowByNumber.get(4) || rowByNumber.get(2);
    if (!fallback) throw new Error("Excel 模板缺少产品行样式：" + config.name);
    const rowByCode = new Map(calculatedRows.filter(Boolean).map(row => [String(row.code), row]));
    const dataRows = [];
    const comments = [];
    products.forEach((product, index) => {
      const number = index + 2;
      const original = rowByNumber.get(originalByCode.get(String(product.code))) || fallback;
      const row = moveRow(original.cloneNode(true), number);
      const calculated = rowByCode.get(String(product.code));
      const prepared = rowValues(config, product, calculated, categoryLabels);
      const defaultProduct = defaultByCode.get(String(product.code));
      if (defaultProduct && product.name === defaultProduct.name) {
        prepared.values.A = readCellText(directElements(original, "c").find(cell => cell.getAttribute("r").startsWith("A")), sharedStrings);
      }
      for (let col = 1; col <= config.width; col++) writeCell(doc, row, columnName(col), number, prepared.values[columnName(col)] || "");
      for (const note of prepared.notes) comments.push({ ref: note.column + number, text: note.text });
      dataRows.push(row);
    });
    const headerRows = originalRows.filter(row => Number(row.getAttribute("r")) < 2);
    const delta = products.length - defaultProducts.length;
    const tailRows = originalRows.filter(row => Number(row.getAttribute("r")) > originalEnd).map(row => moveRow(row.cloneNode(true), Number(row.getAttribute("r")) + delta));
    while (sheetData.firstChild) sheetData.removeChild(sheetData.firstChild);
    for (const row of [...headerRows, ...dataRows, ...tailRows]) sheetData.appendChild(row);
    const dataEnd = products.length + 1;
    const dimension = first(doc, "dimension");
    const lastRow = Math.max(dataEnd, ...tailRows.map(row => Number(row.getAttribute("r"))));
    if (dimension) dimension.setAttribute("ref", "A1:" + config.last + lastRow);
    const filter = first(doc, "autoFilter");
    if (filter) filter.setAttribute("ref", "A1:" + config.last + dataEnd);
    for (const cf of elements(doc, "conditionalFormatting")) {
      if (/^B2:[DG]\d+$/.test(cf.getAttribute("sqref"))) cf.setAttribute("sqref", "B2:" + config.rankEnd + dataEnd);
    }
    return comments;
  }

  function commentsXml(comments) {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<comments xmlns="' + MAIN + '"><authors><author>排名计算工具</author></authors><commentList>' +
      comments.map(comment => '<comment ref="' + comment.ref + '" authorId="0"><text><t xml:space="preserve">' + escapeXml(comment.text) + '</t></text></comment>').join("") +
      '</commentList></comments>';
  }

  function commentsVml(comments) {
    return '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
      '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="1"/></o:shapelayout>' +
      '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
      comments.map((comment, index) => {
        const match = /^([A-Z]+)(\d+)$/.exec(comment.ref);
        const column = columnNumber(match[1]) - 1;
        const row = Number(match[2]) - 1;
        const lines = comment.text.split(/\r?\n/).reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 38)), 0);
        const height = Math.min(600, Math.max(120, lines * 14 + 18));
        const anchorRows = Math.max(8, Math.ceil(height / 18));
        return '<v:shape id="_x0000_s' + (1025 + index) + '" type="#_x0000_t202" style="position:absolute;margin-left:80pt;margin-top:5pt;width:360pt;height:' + height + 'pt;z-index:' + (index + 1) + ';visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">' +
          '<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox style="mso-direction-alt:auto"><div style="text-align:left"/></v:textbox>' +
          '<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:Anchor>' + [column + 1, 15, row, 2, column + 6, 15, row + anchorRows, 2].join(", ") + '</x:Anchor><x:AutoFill>False</x:AutoFill><x:Row>' + row + '</x:Row><x:Column>' + column + '</x:Column></x:ClientData></v:shape>';
      }).join("") + '</xml>';
  }

  function appendType(typesDoc, path, type) {
    const root = typesDoc.documentElement;
    if (!directElements(root, "Override").some(item => item.getAttribute("PartName") === "/" + path)) {
      const override = typesDoc.createElementNS(TYPES, "Override");
      override.setAttribute("PartName", "/" + path);
      override.setAttribute("ContentType", type);
      root.appendChild(override);
    }
  }

  async function patchComments(zip, sheetDoc, sheetPath, comments, index, typesDoc) {
    const relsPath = sheetPath.slice(0, sheetPath.lastIndexOf("/") + 1) + "_rels/" + sheetPath.slice(sheetPath.lastIndexOf("/") + 1) + ".rels";
    const existing = zip.file(relsPath);
    const rels = parseXml(existing ? await existing.async("string") : '<Relationships xmlns="' + PACKAGE_REL + '"/>', relsPath);
    const removedParts = new Set();
    for (const relationship of directElements(rels.documentElement, "Relationship")) {
      if (relationship.getAttribute("Type") === COMMENT_REL || relationship.getAttribute("Type") === VML_REL) {
        const part = resolvePart(sheetPath, relationship.getAttribute("Target"));
        removedParts.add(part);
        zip.remove(part);
        relationship.parentNode.removeChild(relationship);
      }
    }
    for (const legacy of elements(sheetDoc, "legacyDrawing")) legacy.parentNode.removeChild(legacy);
    for (const override of directElements(typesDoc.documentElement, "Override")) {
      if (removedParts.has(override.getAttribute("PartName").replace(/^\//, ""))) override.parentNode.removeChild(override);
    }
    if (comments.length) {
      const commentsPath = "xl/comments-ranking-" + index + ".xml";
      const vmlPath = "xl/drawings/comments-ranking-" + index + ".vml";
      zip.file(commentsPath, commentsXml(comments));
      zip.file(vmlPath, commentsVml(comments));
      const usedIds = new Set(directElements(rels.documentElement, "Relationship").map(item => item.getAttribute("Id")));
      function relationship(type, target) {
        let number = 1;
        while (usedIds.has("rId" + number)) number++;
        const id = "rId" + number;
        usedIds.add(id);
        const node = rels.createElementNS(PACKAGE_REL, "Relationship");
        node.setAttribute("Id", id);
        node.setAttribute("Type", type);
        node.setAttribute("Target", target);
        rels.documentElement.appendChild(node);
        return id;
      }
      relationship(COMMENT_REL, "../comments-ranking-" + index + ".xml");
      const vmlId = relationship(VML_REL, "../drawings/comments-ranking-" + index + ".vml");
      const legacy = sheetDoc.createElementNS(MAIN, "legacyDrawing");
      legacy.setAttributeNS(REL, "r:id", vmlId);
      const following = directElements(sheetDoc.documentElement).find(node => ["legacyDrawingHF", "picture", "oleObjects", "controls", "webPublishItems", "tableParts", "extLst"].includes(node.localName));
      if (following) sheetDoc.documentElement.insertBefore(legacy, following);
      else sheetDoc.documentElement.appendChild(legacy);
      appendType(typesDoc, commentsPath, COMMENT_TYPE);
      if (!directElements(typesDoc.documentElement, "Default").some(item => item.getAttribute("Extension") === "vml")) {
        const type = typesDoc.createElementNS(TYPES, "Default");
        type.setAttribute("Extension", "vml");
        type.setAttribute("ContentType", VML_TYPE);
        typesDoc.documentElement.appendChild(type);
      }
    }
    if (directElements(rels.documentElement).length) zip.file(relsPath, serializeXml(rels));
    else zip.remove(relsPath);
  }

  function patchDefinedNames(workbookDoc, config, sheetIndex, dataEnd) {
    for (const defined of elements(workbookDoc, "definedName")) {
      if (Number(defined.getAttribute("localSheetId")) !== sheetIndex) continue;
      if (["_xlnm._FilterDatabase", "_xlnm.Print_Area"].includes(defined.getAttribute("name"))) {
        defined.textContent = cleanText(defined.textContent).replace(/(\$A\$1:\$[A-Z]+\$)\d+/g, "$1" + dataEnd);
      }
    }
  }

  async function exportWorkbook(templateBytes, products, snapshot, defaultProducts) {
    if (!scope.JSZip) throw new Error("Excel 导出组件未加载，请刷新网页后重试。");
    if (!scope.DOMParser || !scope.XMLSerializer) throw new Error("当前浏览器不支持 Excel 模板导出，请使用新版 Edge、Chrome 或 Firefox。");
    if (!Array.isArray(products) || !products.length) throw new Error("请至少保留一只产品后再导出。");
    if (!Array.isArray(defaultProducts) || !defaultProducts.length) throw new Error("默认产品清单无法读取，请刷新网页后重试。");
    const codes = products.map(product => String(product.code || ""));
    if (codes.some(code => !code) || new Set(codes).size !== codes.length) throw new Error("产品代码不能为空或重复，请先修改产品清单。");
    const zip = await scope.JSZip.loadAsync(templateBytes);
    async function document(path) {
      const file = zip.file(path);
      if (!file) throw new Error("Excel 模板缺少文件：" + path);
      return parseXml(await file.async("string"), path);
    }
    const workbookDoc = await document("xl/workbook.xml");
    const workbookRels = await document("xl/_rels/workbook.xml.rels");
    const typesDoc = await document("[Content_Types].xml");
    const sstFile = zip.file("xl/sharedStrings.xml");
    const sharedStrings = sstFile ? elements(parseXml(await sstFile.async("string"), "xl/sharedStrings.xml"), "si").map(node => elements(node, "t").map(textNode => textNode.textContent).join("")) : [];
    const relationships = new Map(directElements(workbookRels.documentElement, "Relationship").map(item => [item.getAttribute("Id"), item.getAttribute("Target")]));
    const sheets = elements(workbookDoc, "sheet");
    const calculatedRows = Array.isArray(snapshot) ? snapshot : snapshot && snapshot.rows || [];
    if ((snapshot && snapshot.error_count) || calculatedRows.some(row => row && row.error)) throw new Error("排名存在匹配或分类错误，请先处理页面中的错误后再导出。");
    for (let index = 0; index < CONFIG.length; index++) {
      const config = CONFIG[index];
      const sheetIndex = sheets.findIndex(sheet => sheet.getAttribute("name") === config.name);
      if (sheetIndex < 0) throw new Error("Excel 模板缺少工作表：" + config.name);
      const target = relationships.get(sheets[sheetIndex].getAttributeNS(REL, "id"));
      if (!target) throw new Error("Excel 模板的工作表关联无法读取：" + config.name);
      const path = resolvePart("xl/workbook.xml", target);
      const doc = await document(path);
      const comments = patchSheet(doc, config, products, calculatedRows, defaultProducts, sharedStrings);
      await patchComments(zip, doc, path, comments, index + 1, typesDoc);
      patchDefinedNames(workbookDoc, config, sheetIndex, products.length + 1);
      zip.file(path, serializeXml(doc));
    }
    zip.file("xl/workbook.xml", serializeXml(workbookDoc));
    zip.file("[Content_Types].xml", serializeXml(typesDoc));
    return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 } });
  }

  scope.FundRankingExport = Object.freeze({ exportWorkbook });
})(globalThis);
