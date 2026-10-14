/* Browser-local dual-source fund ranking. No network requests or input uploads. */
(function (scope) {
  'use strict';
  const PERIOD_NUMBERS = {'一':1,'1':1,'二':2,'两':2,'2':2,'三':3,'3':3};
  const GALAXY_HEADERS = {fund_code:'交易份额基金代码',fund_name:'交易份额基金简称',management_company:'基金管理人简称',nav_date:'数据截止日期',fund_managers:'净值数据截止日期的基金经理小组成员',period:'滚动时间',growth_rate:'净值增长率（%）',official_rank:'同类型净值增长率排名',category:'银河证券基金三级分类（交易份额基金体系）'};
  const ID_FIELDS = ['基金代码','基金简称','所属公司','现任基金经理','评级分类','计算截止日'];
  const GTHT_COMPANIES = new Set(['国泰海通证券资管','国泰海通资管']);
  const SPECIAL_TEXT = {csi_a500:'包含“中证A500”',csi_1000:'包含“中证1000”',csi_500:'包含“中证500”',csi_300:'包含“沪深300”',kechuang_composite:'同时包含“科创”“综”',zhongzhai_1_3:'同时包含“中债”“1-3”“政”',zhongzhai_0_3:'同时包含“中债0-3”“政”'};
  const POWERS = [1n];
  const text = v => v === null || v === undefined ? '' : String(v).trim();
  const key = v => text(v).normalize('NFKC').replace(/\s+/g,'');
  const nameKey = v => key(v).toUpperCase().replace(/[－—–‑‒−]/g,'-');
  function power(n) { while (POWERS.length <= n) POWERS.push(POWERS[POWERS.length-1]*10n); return POWERS[n]; }

  // Values stay exact decimal integers plus a scale. Comparison never uses a
  // float or a string order, including source strings beyond 16 digits.
  function parseGrowth(value) {
    if (value === null || value === undefined || typeof value === 'boolean') return null;
    let s=text(value).normalize('NFKC');
    if (['','--','-','—','N/A','n/a','None'].includes(s)) return null;
    s=s.replace(/%$/,'').trim().replace(/,/g,'');
    const match=/^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(s);
    if (!match) return null;
    const fraction=match[3]!==undefined ? match[3] : (match[4]||'');
    const exponent=Number(match[5]||0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent)>1000 || s.length>2500) return null;
    let n=BigInt((match[2]||'0')+fraction); if (match[1]==='-') n=-n;
    let scale=fraction.length-exponent;
    if (scale<0) { n*=power(-scale);scale=0; }
    while (scale>0 && n%10n===0n) { n/=10n;scale--; }
    return {n,scale};
  }
  function compareDecimal(a,b) {
    const scale=Math.max(a.scale,b.scale);const an=a.n*power(scale-a.scale),bn=b.n*power(scale-b.scale);
    return an<bn ? -1 : an>bn ? 1 : 0;
  }
  function decimalText(value) {
    if (!value) return '';
    const sign=value.n<0n ? '-' : '';let digits=(value.n<0n ? -value.n:value.n).toString();
    if (!value.scale) return sign+digits;
    digits=digits.padStart(value.scale+1,'0');return sign+digits.slice(0,-value.scale)+'.'+digits.slice(-value.scale);
  }
  function categoryCode(value) { const match=/^(\d+\.\d+\.\d+)(?![\d.])/.exec(text(value));return match ? match[1] : null; }
  function normalizePeriod(value,strict=true) {
    const match=(strict ? /^(?:过去|最近|近)([一二两三123])年$/ : /^(?:过去|最近|近)([一二两三123])年/).exec(key(value));
    if (!match) {if(strict) throw new Error(`滚动期间无法识别：${text(value)}`);return null;} return PERIOD_NUMBERS[match[1]];
  }
  function fundCode(value,galaxy=false) {
    if(value===null || value===undefined || typeof value==='boolean')return null;
    let s=text(value);if (/^\d{1,6}(?:\.0+)?$/.test(s))s=s.split('.')[0].padStart(6,'0');
    return (galaxy ? /^(?=.*\d)[A-Za-z0-9]{6}$/ : /^\d{6}$/).test(s) ? s : null;
  }
  function dateText(value,date1904=false) {
    if(value instanceof Date && !Number.isNaN(value.valueOf()))return value.toISOString().slice(0,10);
    const s=key(value);let parts;
    if(/^\d{8}(?:\.0+)?$/.test(s)){const d=s.split('.')[0];parts=[d.slice(0,4),d.slice(4,6),d.slice(6,8)];}
    else if(/^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}$/.test(s))parts=s.split(/[.\-/]/);
    else if(typeof value==='number' && Number.isFinite(value) && value>=1 && value<100000){
      // Excel's 1900 date system includes its fictitious 1900-02-29.
      const base=Date.UTC(date1904?1904:1899,date1904?0:11,date1904?1:31);
      const days=Math.floor(value)-(date1904?0:(value>=60?1:0));return new Date(base+days*86400000).toISOString().slice(0,10);
    } else throw new Error(`源报表数据截止日期无法识别：${text(value)}`);
    const [y,m,d]=parts.map(Number);const parsed=new Date(Date.UTC(y,m-1,d));
    if(parsed.getUTCFullYear()!==y || parsed.getUTCMonth()!==m-1 || parsed.getUTCDate()!==d)throw new Error(`源报表数据截止日期无效：${s}`);
    return `${String(y).padStart(4,'0')}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  function validISODate(value) {return /^\d{4}-\d{2}-\d{2}$/.test(text(value)) && dateText(value)===value;}
  function managerText(value) {return [...new Set(text(value).split(/[、,，;；\n]+/).map(s=>s.trim()).filter(Boolean))].join('、');}
  function specialGroup(category,name) {
    const n=nameKey(name);
    if(category==='1.5.1'){
      if(n.includes('中证A500'))return 'csi_a500';if(n.includes('中证1000'))return 'csi_1000';
      if(n.includes('中证500'))return 'csi_500';if(n.includes('沪深300'))return 'csi_300';
      if(n.includes('科创')&&n.includes('综'))return 'kechuang_composite';
    }
    if(category==='3.7.1'){
      if(n.includes('中债')&&n.includes('1-3')&&n.includes('政'))return 'zhongzhai_1_3';
      if(n.includes('中债0-3')&&n.includes('政'))return 'zhongzhai_0_3';
    }
    return null;
  }
  function specialMatches(group,name) {
    const n=nameKey(name);
    const checks={csi_a500:()=>n.includes('中证A500'),csi_1000:()=>n.includes('中证1000'),csi_500:()=>n.includes('中证500'),csi_300:()=>n.includes('沪深300'),kechuang_composite:()=>n.includes('科创')&&n.includes('综'),zhongzhai_1_3:()=>n.includes('中债')&&n.includes('1-3')&&n.includes('政'),zhongzhai_0_3:()=>n.includes('中债0-3')&&n.includes('政')};
    if(!checks[group])throw new Error(`未知特殊比较组：${group}`);return checks[group]();
  }
  function officialRank(value) {
    const match=/^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(text(value));if(!match)return null;
    const rank=Number(match[1]),total=Number(match[2]);
    if(!Number.isSafeInteger(rank)||!Number.isSafeInteger(total)||rank<1||total<1||rank>total)throw new Error(`源表排名无效：${text(value)}`);
    return {position:rank,total};
  }
  function rankingResult(position,total,method,note='',group=null) {
    const percent=Number((BigInt(position)*100n+BigInt(total)-1n)/BigInt(total));
    return {rank:`前${percent}%(${position}/${total})`,status:method,method,position,total,percent,note,special_group:group};
  }
  function blankRank(status) {
    const notes={not_uploaded:'对应来源或期间尚未上传。',no_growth:'源报表未披露有效收益率，无法排名。',no_source:'已上传的报表未披露该产品。'};
    return {rank:status==='not_uploaded'?'未上传':'--',status,method:status,note:notes[status]||''};
  }

  // Read the actual cell grid instead of trusting !ref. Galaxy reports have
  // historically claimed an A1-only used range while containing 27,000 rows.
  function sheetRows(sheet) {
    if(sheet['!data'])return sheet['!data'].map(row=>row ? row.map(cell=>cell===undefined||cell===null ? null : (typeof cell==='object'&&'v' in cell?cell.v:cell)) : []);
    if(Array.isArray(sheet))return sheet.map(row=>row?row.map(cell=>cell&&typeof cell==='object'&&'v'in cell?cell.v:cell):[]);
    const rows=[];
    for(const [address,cell] of Object.entries(sheet)){
      const match=/^([A-Z]+)(\d+)$/.exec(address);if(!match)continue;
      let col=0;for(const c of match[1])col=col*26+c.charCodeAt(0)-64;col--;
      const row=Number(match[2])-1;while(rows.length<=row)rows.push([]);rows[row][col]=cell&&typeof cell==='object'&&'v'in cell?cell.v:cell;
    }
    return rows;
  }
  function galaxyColumns(row,location) {
    const wanted=new Map(Object.entries(GALAXY_HEADERS).map(([field,label])=>[key(label),field]));const found={};
    row.forEach((v,c)=>{const f=wanted.get(key(v));if(f)(found[f]||(found[f]=[])).push(c);});
    const missing=Object.keys(GALAXY_HEADERS).filter(f=>!found[f]).map(f=>GALAXY_HEADERS[f]);
    if(missing.length)return {columns:null,missing};
    const duplicates=Object.keys(found).filter(f=>found[f].length>1);if(duplicates.length)throw new Error(`${location}：必要表头重复或有歧义：${duplicates.map(f=>GALAXY_HEADERS[f]).join('、')}`);
    return {columns:Object.fromEntries(Object.entries(found).map(([f,c])=>[f,c[0]])),missing:[]};
  }
  function parseGalaxySheet(rows,sheetName,fileName,date1904) {
    let columns=null,period=null;const records=[];let missingBest=Object.values(GALAXY_HEADERS);
    for(let i=0;i<rows.length;i++){
      const row=rows[i]||[];const location=`${fileName} / ${sheetName} / 第${i+1}行`;
      if(!columns){const candidate=galaxyColumns(row,location);if(candidate.missing.length<missingBest.length)missingBest=candidate.missing;if(candidate.columns)columns=candidate.columns;continue;}
      const get=f=>row[columns[f]];const code=fundCode(get('fund_code'),true);
      if(!code){const candidate=galaxyColumns(row,location);if(candidate.columns)columns=candidate.columns;else if(row.some(v=>/^(执业说明|免责声明)(:|：|$)/.test(key(v))))break;continue;}
      const name=text(get('fund_name'));if(!name)continue;
      const p=normalizePeriod(get('period'));if(period===null)period=p;else if(period!==p)throw new Error(`${location}：同一银河报表含有混合滚动期间`);
      const category=text(get('category'));
      records.push({fund_code:code,fund_name:name,management_company:text(get('management_company')),period:p,nav_date:dateText(get('nav_date'),date1904),fund_managers:text(get('fund_managers')),growth_rate:parseGrowth(get('growth_rate')),official_rank:text(get('official_rank')),category,category_code:categoryCode(category),source_file:fileName,source_sheet:sheetName,source_row:i+1});
    }
    return {period,records,missing:missingBest};
  }
  function identityField(value) {const k=key(value).split(/[([]/,1)[0];return ID_FIELDS.includes(k)?k:null;}
  function periodLabel(value) {
    const p=normalizePeriod(value,false);if(p)return {period:p,label:text(value)};
    const k=key(value);if(/^(?:最近|过去|近).+(?:年|季|月)/.test(k)||/^(今年以来|成立以来)/.test(k))return {period:null,label:text(value)};return null;
  }
  function indicator(value) {
    let k=key(value);const p=/^(?:最近|过去|近)([一二两三123])年/.exec(k);
    if(p){k=k.slice(p[0].length);k=k.replace(/[([][^)\]]*[)\]]/g,'');}
    k=k.replace(/(?:\[[^\]]*\]|\([^)]*\)|%)$/,'');
    if(k==='超额收益率')return ['excess','value'];if(['超额排名','超额收益率排名'].includes(k))return ['excess','rank'];
    if(['收益率','净值增长率'].includes(k))return ['performance','value'];if(['排名','收益率排名','净值增长率排名'].includes(k))return ['performance','rank'];return null;
  }
  function discoverGthtLayout(rows,sheet,sheetName) {
    const headers=[],locations={};let first=-1;
    for(let i=0;i<rows.length;i++){
      const row=rows[i]||[];const codeCols=locations['基金代码'];const hasCode=codeCols&&[...codeCols].some(c=>fundCode(row[c]));
      const hasUnlabelled=!codeCols&&locations['基金简称']&&[...locations['基金简称']].some(c=>text(row[c])&&!identityField(row[c]))&&row.some(v=>fundCode(v));
      if(hasCode||hasUnlabelled){first=i;break;}
      headers.push([i,row]);row.forEach((v,c)=>{const field=identityField(v);if(field)(locations[field]||(locations[field]=new Set())).add(c);});
    }
    if(first<0)return null;
    const columns={};for(const [field,cols] of Object.entries(locations)){if(cols.size>1)throw new Error(`${sheetName}：表头重复或有歧义：${field}`);columns[field]=[...cols][0];}
    for(const field of ['基金代码','基金简称','所属公司','现任基金经理'])if(columns[field]===undefined)throw new Error(`${sheetName}：缺少必要表头“${field}”`);
    if(columns['评级分类']===undefined&&key(sheetName)!=='货币型')throw new Error(`${sheetName}：缺少必要表头“评级分类”`);
    const width=Math.max(...headers.map(([,row])=>row.length));const grid=new Map(headers.map(([r,row])=>[r,Array.from({length:width},(_,c)=>row[c]===undefined?null:row[c])]));const extents=new Map();
    for(const merge of sheet['!merges']||[]){
      if(!grid.has(merge.s.r))continue;const value=grid.get(merge.s.r)[merge.s.c];
      for(let r=merge.s.r;r<=Math.min(merge.e.r,first-1);r++){
        if(!grid.has(r))continue;for(let c=merge.s.c;c<=Math.min(merge.e.c,width-1);c++){if(grid.get(r)[c]===null)grid.get(r)[c]=value;extents.set(`${r}:${c}`,merge.e.c);}
      }
    }
    const contexts=new Map();
    for(const [r,row] of grid){const occupied=[];row.forEach((v,c)=>{if(key(v))occupied.push(c);});
      for(let pos=0;pos<occupied.length;pos++){const c=occupied[pos],p=periodLabel(row[c]);if(!p)continue;const end=Math.min(pos+1<occupied.length?occupied[pos+1]-1:width-1,extents.get(`${r}:${c}`)??(width-1));for(let t=c;t<=end;t++)contexts.set(`${r}:${t}`,p);}
    }
    const values={performance:{},excess:{}},ranks={performance:{},excess:{}},labels={performance:{},excess:{}};
    for(let c=0;c<width;c++){let active=null,seen=null;
      for(const [r,row] of grid){if(contexts.has(`${r}:${c}`))active=contexts.get(`${r}:${c}`);const ind=indicator(row[c]);if(!active||active.period===null||!ind)continue;
        if(seen&&String(seen)!==String(ind))throw new Error(`${sheetName}：第${c+1}列的指标表头有歧义`);seen=ind;
        const [metric,kind]=ind,target=kind==='value'?values[metric]:ranks[metric];
        if(target[active.period]!==undefined&&target[active.period]!==c)throw new Error(`${sheetName}：近${active.period}年${metric==='excess'?'超额收益':'业绩'}${kind==='value'?'收益率':'排名'}列重复`);
        target[active.period]=c;if(kind==='value')labels[metric][active.period]=active.label;
      }
    }
    const metric=Object.keys(values.excess).length?'excess':Object.keys(values.performance).length?'performance':null;
    if(!metric)throw new Error(`${sheetName}：未识别到近一年、两年或三年的收益率字段`);
    return {first,columns,values,ranks,labels,metric};
  }
  function headerDate(label,date1904) {
    const dates=text(label).match(/\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}/g)||[];if(dates.length<2)throw new Error(`报表期间没有明确截止日期：${label}`);return dateText(dates[dates.length-1],date1904);
  }
  function parseGthtSheet(rows,sheet,sheetName,fileName,date1904) {
    const layout=discoverGthtLayout(rows,sheet,sheetName);if(!layout)return null;
    const {columns,metric,values,ranks,labels}=layout;const records=[];
    for(let i=layout.first;i<rows.length;i++){
      const row=rows[i]||[];const get=h=>columns[h]===undefined?undefined:row[columns[h]];const code=fundCode(get('基金代码'));const name=text(get('基金简称'));if(!code||!name)continue;
      const category=text(get('评级分类'))||(key(sheetName)==='货币型'?'货币型':'');if(!category)throw new Error(`${sheetName}第${i+1}行：基金${code}缺少评级分类`);
      for(const p of Object.keys(values[metric]).map(Number).sort((a,b)=>a-b)){
        const label=labels[metric][p],rowDate=get('计算截止日');const asOf=rowDate!==null&&rowDate!==undefined?dateText(rowDate,date1904):headerDate(label,date1904);
        records.push({fund_code:code,fund_name:name,company:text(get('所属公司')),category,manager:text(get('现任基金经理')),period:p,value:parseGrowth(row[values[metric][p]]),official_rank:text(row[ranks[metric][p]]),as_of:asOf,source_file:fileName,source_sheet:sheetName,source_row:i+1,metric,source_period_label:label});
      }
    }
    return {metric,records};
  }
  function parseWorkbook(workbook,fileName='上传报表.xlsx') {
    if(!workbook||!Array.isArray(workbook.SheetNames)||!workbook.SheetNames.length)throw new Error('Excel未包含可读取的工作表');
    const date1904=!!(workbook.Workbook&&workbook.Workbook.WBProps&&workbook.Workbook.WBProps.date1904);
    const sheets=workbook.SheetNames.map(name=>({name,sheet:workbook.Sheets[name],rows:sheetRows(workbook.Sheets[name])}));
    const isGalaxy=sheets.some(({rows})=>rows.some(row=>{const labels=new Set((row||[]).map(key));return labels.has('交易份额基金简称')&&labels.has('滚动时间');}));
    let kind,records=[],periods=[];
    if(isGalaxy){kind='galaxy';let dataSheet='';let missing=Object.values(GALAXY_HEADERS);
      for(const item of sheets){const parsed=parseGalaxySheet(item.rows,item.name,fileName,date1904);if(parsed.missing.length<missing.length)missing=parsed.missing;
        if(!parsed.records.length)continue;if(dataSheet)throw new Error(`银河基金数据工作表有歧义：${dataSheet}、${item.name}`);dataSheet=item.name;records=parsed.records;periods=[parsed.period];}
      if(!records.length)throw new Error(missing.length?`未找到完整银河表头，缺少：${missing.join('、')}`:'银河报表没有基金记录');
    } else {
      const metrics=new Set();for(const item of sheets){if(/封面|汇总|全部基金|数据说明|重要声明/.test(key(item.name)))continue;
        const parsed=parseGthtSheet(item.rows,item.sheet,item.name,fileName,date1904);if(!parsed)continue;metrics.add(parsed.metric);records.push(...parsed.records);}
      if(metrics.size!==1||!records.length)throw new Error('无法根据必要表头明确识别银河、国泰海通业绩或超额收益报表，请检查来源文件');
      kind=[...metrics][0];periods=[...new Set(records.map(r=>r.period))].sort((a,b)=>a-b);
    }
    const seen=new Set();for(const record of records){const id=`${record.fund_code}:${record.period}`;if(seen.has(id))throw new Error(`源报表基金代码和期间重复：${record.fund_code} / 近${record.period}年`);seen.add(id);}
    const dates=[...new Set(records.map(r=>kind==='galaxy'?r.nav_date:r.as_of))].sort();
    if(new Set(dates.map(d=>d.slice(0,7))).size!==1)throw new Error('同一源报表含有不同月份的数据截止日期');
    if(kind==='galaxy'&&dates.length!==1)throw new Error('银河报表数据截止日期不一致');
    return {key:kind==='galaxy'?`galaxy:${periods[0]}`:kind,kind,records,periods,name:fileName,dates};
  }
  function validateProducts(products) {
    if(!Array.isArray(products)||products.length<1||products.length>500)throw new Error('产品清单需要1至500只产品');
    const codes=new Set();return products.map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('产品清单格式错误');
      const p=Object.fromEntries(['name','code','galaxy_category','gtht_category'].map(field=>[field,text(item[field])]));
      if(!p.name||typeof item.code!=='string'||!/^\d{6}$/.test(p.code))throw new Error('产品简称不能为空，基金代码必须是六位文本数字');
      if(!/^\d+\.\d+\.\d+$/.test(p.galaxy_category))throw new Error(`银河分类编号无效：${p.name}`);
      if(!p.gtht_category)throw new Error(`国泰海通基金所属分类为空：${p.name}`);
      if(codes.has(p.code))throw new Error(`产品基金代码重复：${p.code}`);codes.add(p.code);return p;
    });
  }
  function recordValue(record,kind) {return kind==='galaxy'?record.growth_rate:record.value;}
  function rankRecord(record,report) {
    const kind=report.kind,value=recordValue(record,kind);if(value===null||value===undefined)return blankRank('no_growth');
    const category=kind==='galaxy'?record.category_code:key(record.category);const specialCategory=kind==='galaxy'?category:({'增强股票指数型':'1.5.1','复制债券指数型':'3.7.1'}[category]);
    const group=specialGroup(specialCategory,record.fund_name);
    if(!group){const official=officialRank(record.official_rank);if(official)return {...rankingResult(official.position,official.total,'official','使用源表已披露的同类型排名。'),value:decimalText(value),source_name:record.fund_name,source_row:record.source_row,source_sheet:record.source_sheet};}
    const peers=report.records.filter(peer=>peer.period===record.period&&(kind==='galaxy'?peer.category_code===category:key(peer.category)===category&&peer.source_sheet===record.source_sheet&&peer.metric===record.metric)&&(!group||specialMatches(group,peer.fund_name))&&recordValue(peer,kind)!==null&&recordValue(peer,kind)!==undefined);
    if(!peers.some(peer=>peer.fund_code===record.fund_code))throw new Error(`目标产品${record.fund_code}未进入有效数值比较组`);
    const higher=peers.filter(peer=>compareDecimal(recordValue(peer,kind),value)>0).length;const position=higher+1;
    const tied=peers.filter(peer=>compareDecimal(recordValue(peer,kind),value)===0);const otherTies=tied.filter(peer=>peer.fund_code!==record.fund_code);
    let note=group?`同分类内筛选基金简称${SPECIAL_TEXT[group]}的有效收益率手动排名。`:'源表未披露可用排名，按同一基金分类的有效收益率手动排名。';
    if(kind!=='galaxy')note+='比较样本限于同一源工作表、评级分类、期间及指标。';
    note+=`收益率统一转换为数值；当前收益率${decimalText(value)}%，有效样本${peers.length}只，高于该收益率${higher}只，排名${position}/${peers.length}；百分比采用进一法。`;
    if(otherTies.length){const peersShown=otherTies.slice(0,50).map(peer=>`${peer.fund_name}（${peer.fund_code}）`).join('、');note+=`并列排名：与${peersShown}${otherTies.length>50?`等${otherTies.length}只产品`:''}收益率相同（${decimalText(value)}%），共同排并列第${position}名。采用“1＋收益率严格高于的产品数”，后续名次跳过并列占用的位置（1、2、2、4）。`;}
    return {...rankingResult(position,peers.length,group?'manual_special':'manual_missing',note,group),value:decimalText(value),source_name:record.fund_name,source_row:record.source_row,source_sheet:record.source_sheet,tie_count:tied.length,ties:otherTies.slice(0,50).map(peer=>({name:peer.fund_name,code:peer.fund_code}))};
  }
  function calculate(reportsArray,rawProducts) {
    const products=validateProducts(rawProducts);if(!Array.isArray(reportsArray))throw new Error('已上传报表清单格式无效');
    const loaded=new Map(),dates=new Set(),galaxyDates=new Set(),indexes=new Map(),metadata=[];
    const available={galaxy:[],performance:[],excess:[]};
    for(const report of reportsArray){
      if(!report||!['galaxy','performance','excess'].includes(report.kind)||!Array.isArray(report.records)||!report.records.length)throw new Error('报表来源无效或没有基金记录');
      const periods=[...new Set(report.records.map(r=>r.period))].sort((a,b)=>a-b);
      if(periods.some(p=>![1,2,3].includes(p))||report.kind==='galaxy'&&periods.length!==1)throw new Error('源报表滚动期间混合或无效');
      const reportKey=report.kind==='galaxy'?`galaxy:${periods[0]}`:report.kind;if(loaded.has(reportKey))throw new Error(`重复来源/期间：${reportKey}`);loaded.set(reportKey,report);
      const cutoffs=new Set(),index=new Map();
      for(const record of report.records){
        if(report.kind!=='galaxy'&&record.metric!==report.kind)throw new Error('国泰海通报表指标混用');
        const cutoff=report.kind==='galaxy'?record.nav_date:record.as_of;if(!validISODate(cutoff))throw new Error(`源报表数据截止日期无效：${record.fund_code}/${cutoff}`);
        cutoffs.add(cutoff);dates.add(cutoff);if(report.kind==='galaxy')galaxyDates.add(cutoff);
        const id=`${record.fund_code}:${record.period}`;if(index.has(id))throw new Error(`源表基金代码和期间重复：${id}`);index.set(id,record);
      }
      indexes.set(reportKey,index);available[report.kind].push(...periods);
      metadata.push({key:reportKey,kind:report.kind,source:report.kind==='galaxy'?'银河':'国泰海通',metric:report.kind==='excess'?'超额收益':'业绩',name:report.name,periods,dates:[...cutoffs].sort(),records:report.records.length});
    }
    if(new Set([...dates].map(d=>d.slice(0,7))).size>1)throw new Error('已上传报表月份不一致，请清空后上传同一月份报表');
    if(galaxyDates.size>1)throw new Error('已上传银河报表的数据截止日期不一致');
    for(const metric of Object.keys(available))available[metric]=[...new Set(available[metric])].sort((a,b)=>a-b);
    const errors=[],warnings=[],rows=[];const updates={'银河排名':{},'国泰海通排名':{}};
    for(let i=0;i<products.length;i++){
      const product=products[i],rowErrors=[],gManagers=new Set(),hManagers={};
      const output={name:product.name,code:product.code,galaxy:{category:product.galaxy_category,manager:'',ranks:{}},gtht:{category:product.gtht_category,manager:'',performance:{},excess:{}}};
      const fail=(message,rankContainer,period)=>{rowErrors.push(message);if(rankContainer)rankContainer[period]={rank:'错误',status:'error',method:'error',note:message,error:message};};
      for(const p of [1,2,3]){
        const reportKey=`galaxy:${p}`,report=loaded.get(reportKey);if(!report){output.galaxy.ranks[p]=blankRank('not_uploaded');continue;}
        const record=indexes.get(reportKey).get(`${product.code}:${p}`);
        try{
          if(!record)throw new Error(`银河近${p}年找不到目标产品：${product.name}（${product.code}）`);
          if(record.management_company!=='国泰海通证券资管')throw new Error(`银河目标产品基金管理人不符：${product.code}/${record.management_company}`);
          if(record.category_code!==product.galaxy_category)throw new Error(`银河分类不符：${product.name}（${product.code}），产品清单${product.galaxy_category}，源表${record.category_code}`);
          output.galaxy.category=record.category;if(record.fund_managers)gManagers.add(record.fund_managers);
          output.galaxy.ranks[p]=rankRecord(record,report);
        }catch(error){fail(error.message,output.galaxy.ranks,p);}
      }
      if(gManagers.size>1)fail(`银河已上传期间基金经理不一致：${product.name}（${product.code}）`);output.galaxy.manager=[...gManagers][0]||'';
      const targetCategory=text(product.gtht_category.split('-').pop());
      for(const metric of ['performance','excess']){
        const report=loaded.get(metric);for(const p of [1,2,3]){
          if(!report||!available[metric].includes(p)){output.gtht[metric][p]=blankRank('not_uploaded');continue;}
          const record=indexes.get(metric).get(`${product.code}:${p}`);
          try{
            if(!record){if(metric==='performance')throw new Error(`国泰海通业绩报表缺少目标产品：${product.name}（${product.code}）`);output.gtht[metric][p]=blankRank('no_source');continue;}
            if(!GTHT_COMPANIES.has(record.company))throw new Error(`国泰海通目标产品所属公司不符：${product.code}/${record.company}`);
            if(record.category!==targetCategory)throw new Error(`国泰海通评级分类不符：${product.name}（${product.code}），产品清单${targetCategory}，源表${record.category}`);
            hManagers[metric]=managerText(record.manager);output.gtht[metric][p]=rankRecord(record,report);
          }catch(error){fail(error.message,output.gtht[metric],p);}
        }
      }
      output.gtht.manager=hManagers.performance!==undefined?hManagers.performance:(hManagers.excess||'');
      if(!output.gtht.manager&&Object.keys(hManagers).length)fail(`已上传国泰海通报表现任基金经理为空：${product.name}（${product.code}）`);
      if(hManagers.performance&&hManagers.excess&&[...new Set(hManagers.performance.split('、'))].sort().join('、')!==[...new Set(hManagers.excess.split('、'))].sort().join('、'))warnings.push(`${product.name}两份国泰海通报表经理不同，已使用业绩报表：${output.gtht.manager}`);
      if(loaded.has('excess')&&available.excess.every(p=>output.gtht.excess[p].status==='no_source'))warnings.push(`${product.name}超额收益源表未披露，已上传期间均为--`);
      if(rowErrors.length){output.error=[...new Set(rowErrors)].join('；');errors.push({code:product.code,name:product.name,error:output.error});}
      rows.push(output);
      updates['银河排名'][i+2]={B:output.galaxy.ranks[1].rank,C:output.galaxy.ranks[2].rank,D:output.galaxy.ranks[3].rank,E:output.galaxy.manager};
      updates['国泰海通排名'][i+2]={B:output.gtht.performance[1].rank,C:output.gtht.excess[1].rank,D:output.gtht.performance[2].rank,E:output.gtht.excess[2].rank,F:output.gtht.performance[3].rank,G:output.gtht.excess[3].rank,H:'',I:'',J:output.gtht.manager};
    }
    const asOf=[...dates].sort().pop()||'';return {as_of:asOf,report_count:loaded.size,available,reports:metadata,rows,products,updates,warnings,errors,error_count:errors.length,counts:{products:products.length,reports:loaded.size,errors:errors.length,ranking_columns:Object.values(available).reduce((n,p)=>n+p.length,0)}};
  }
  const api={parseWorkbook,validateProducts,calculate,parseGrowth,compareDecimal,decimalText,formatRank:(r,t)=>rankingResult(r,t,'manual_missing').rank};
  scope.FundRankingEngine=api;if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis==='object'?globalThis:self);
