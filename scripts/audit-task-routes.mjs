import fs from 'node:fs';
import ts from 'typescript';
const text=fs.readFileSync('client/src/App.tsx','utf8');
const source=ts.createSourceFile('App.tsx',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const imports=Object.fromEntries([...text.matchAll(/const (\w+) = lazy\(\(\) => import\("(@\/pages\/[^"\n]+)"\)\)/g)].map(m=>[m[1],m[2].replace('@/','client/src/')+'.tsx']));
const routes=[];
function walk(n){if(ts.isJsxElement(n)||ts.isJsxSelfClosingElement(n)){
 const el=ts.isJsxElement(n)?n.openingElement:n;
 if(el.tagName.getText(source)==='Route'){
 const attr=el.attributes.properties.find(p=>p.name?.getText(source)==='path');
 const path=attr?.initializer&&ts.isStringLiteral(attr.initializer)?attr.initializer.text:null;
 if(path){const code=n.getText(source);const components=Object.keys(imports).filter(name=>new RegExp('\\b'+name+'\\b').test(code));routes.push({path,audience:path.startsWith('/admin')?'owner':path.startsWith('/crew')?'crew':'customer / shared',components:components.map(name=>imports[name]),redirect:/<Redirect|PlannerLegacyRedirect/.test(code),review:'pending'});}
 }
}ts.forEachChild(n,walk);}
walk(source);
for(const route of routes){
 const sourceText=route.components.map(file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'').join('\n');
 const labels=[...sourceText.matchAll(/<(?:Label|label)[^>]*>([^<{}]+)<\/(?:Label|label)>/g)].map(m=>m[1].trim());
 const actions=[...sourceText.matchAll(/<Button[^>]*>([^<{}]+)<\/Button>/g)].map(m=>m[1].trim());
 const details=[...sourceText.matchAll(/<TaskDetails title="([^"]+)"/g)].map(m=>m[1]);
 route.purpose=route.redirect?'Preserve existing entry URL':route.components.map(f=>f.replace('client/src/pages/','').replace('.tsx','')).join(' / ')||'Role-dependent landing or inline route';
 route.inputCandidates=[...new Set(labels)];route.actionCandidates=[...new Set(actions)];route.optionalSections=[...new Set(details)];
 route.auditNote='Source inventory only. Required inputs, primary action, role variants, and runtime behavior still require page review.';
}
fs.mkdirSync('docs',{recursive:true});
fs.writeFileSync('docs/task-route-inventory.json',JSON.stringify(routes,null,2)+'\n');
console.log(`${routes.length} route registrations; ${new Set(routes.map(r=>r.path)).size} distinct paths; ${new Set(routes.flatMap(r=>r.components)).size} page components.`);
