/* Keep large source tables and ranking work off the main browser UI thread. */
'use strict';
importScripts('xlsx.full.min.js','rank-engine.js');
let products=[];
let reports=new Map();
function matchingIssues(snapshot){
  // A row may contain several independent problems. Compare each one so a
  // replacement can fix some existing problems without blocking on the rest.
  return (snapshot.errors||[]).flatMap(issue=>String(issue.error||'').split('；').filter(Boolean).map(error=>({code:issue.code,error,key:`${issue.code}\u0000${error}`})));
}
self.onmessage=function(event){
  const message=event.data||{};const id=message.id;
  const progress=value=>self.postMessage({id,progress:value});
  try{
    let candidateProducts=products,candidateReports=new Map(reports),replaced=false,parsed=null;
    switch(message.type){
      case 'init': candidateProducts=FundRankingEngine.validateProducts(message.products);candidateReports=new Map();break;
      case 'products': candidateProducts=FundRankingEngine.validateProducts(message.products);break;
      case 'upload': {
        if(!products.length)throw new Error('产品清单尚未初始化');
        if(!message.buffer)throw new Error('没有收到报表文件内容');
        progress('正在读取Excel内容…');
        const workbook=XLSX.read(new Uint8Array(message.buffer),{type:'array',dense:true,nodim:true,cellDates:false,cellText:false,cellHTML:false});
        progress('正在识别来源、滚动期间和表头…');
        parsed=FundRankingEngine.parseWorkbook(workbook,message.name||'上传报表.xlsx');
        replaced=candidateReports.has(parsed.key);
        if(replaced&&!message.replaceExisting)throw new Error(`已上传同一来源或期间（${parsed.key}），请明确选择替换原报表`);
        candidateReports.set(parsed.key,parsed);break;
      }
      case 'remove': if(!candidateReports.has(message.key))throw new Error('找不到要移除的报表');candidateReports.delete(message.key);break;
      case 'clear': candidateReports=new Map();break;
      case 'snapshot': break;
      default: throw new Error('无法识别操作类型');
    }
    progress('正在按已确认规则计算排名…');
    const snapshot=FundRankingEngine.calculate([...candidateReports.values()],candidateProducts);
    if(message.type==='upload'&&replaced){
      const original=FundRankingEngine.calculate([...reports.values()],products);
      const originalIssues=new Set(matchingIssues(original).map(issue=>issue.key));
      const introduced=matchingIssues(snapshot).find(issue=>!originalIssues.has(issue.key));
      if(introduced)throw new Error(`替换报表产生新的匹配问题，原报表已保留：${introduced.error}`);
    }
    // Commit only after all global data/date validation and ranking succeeds.
    products=candidateProducts;reports=candidateReports;
    self.postMessage({id,ok:true,snapshot,replaced,key:parsed?parsed.key:message.key,report:parsed?snapshot.reports.find(r=>r.key===parsed.key):undefined});
  }catch(error){self.postMessage({id,ok:false,error:error&&error.message?error.message:String(error)});}
};
