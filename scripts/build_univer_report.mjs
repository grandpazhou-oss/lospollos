// Build only the local read-only SDK bridge, using an existing SDK checkout and its dependencies.
// No package-manager commands, SDK writes, hooks, network requests or commercial packages.
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const sdk = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/build_univer_report.mjs <installed-univer-sdk>');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await fs.readFile(path.join(sdk,'package.json'),'utf8'));
if (pkg.version !== '1.0.3') throw new Error('Review SDK API compatibility before changing the pinned 1.0.3 build');
const requireSdk = createRequire(path.join(sdk,'examples/package.json'));
const requireTsx = createRequire(requireSdk.resolve('tsx/package.json'));
const { build } = requireTsx('esbuild');
const tailwind = requireSdk('tailwindcss');
const { tsImport } = requireSdk('tsx/esm/api');
const { default: preset } = await tsImport(path.join(sdk,'common/shared/tailwind/tailwind.config.ts'),import.meta.url);
const target=path.join(root,'vendor/univer');
await fs.mkdir(target,{recursive:true});
const built=await build({entryPoints:[path.join(root,'scripts/univer-report-entry.ts')],outfile:path.join(target,'report.js'),bundle:true,metafile:true,
    minify:true,format:'iife',globalName:'STCTUniverEvidence',target:'es2020',legalComments:'inline',jsx:'automatic',
    tsconfigRaw:{compilerOptions:{experimentalDecorators:true,useDefineForClassFields:false}},
    loader:{'.module.css':'local-css','.svg':'dataurl'},
    plugins:[{name:'installed-sdk-resolution',setup(b){b.onResolve({filter:/^(@univerjs\/|react(?:$|\/)|react-dom(?:$|\/)|rxjs$)/},args=>{
        if(args.path.startsWith('@univerjs/')){
            const [name,...parts]=args.path.slice('@univerjs/'.length).split('/');
            const directory=[path.join(sdk,'packages',name),path.join(sdk,'presets/packages',name),name==='presets'?path.join(sdk,'presets'):null].find(d=>d&&existsSync(path.join(d,'package.json')));
            if(directory){
                const source=path.join(directory,'src',parts.join('/')||'index');
                const found=[source,source+'.ts',source+'.tsx',path.join(source,'index.ts')].find(p=>existsSync(p)&&!p.endsWith('/facade'));
                if(found)return {path:found};
            }
        }
        return {path:requireSdk.resolve(args.path)};
    });}}],
});
const postcss=requireSdk('postcss');
const css=await postcss([tailwind({presets:[preset],content:['design','ui','sheets-ui','docs-ui','sheets-formula-ui','sheets-numfmt-ui'].map(name=>path.join(sdk,'packages',name,'src/**/*.tsx')),plugins:[requireSdk('tailwindcss-animate')]})])
    .process(await fs.readFile(path.join(target,'report.css'),'utf8'),{from:path.join(target,'report.css')});
await fs.writeFile(path.join(target,'report.css'),css.css);
await fs.copyFile(path.join(sdk,'LICENSE'),path.join(root,'vendor/univer/LICENSE'));
const dependencies=new Map();
for(const input of Object.keys(built.metafile.inputs)){
    let directory=path.dirname(path.resolve(input));
    while(directory!==path.dirname(directory)&&!existsSync(path.join(directory,'package.json')))directory=path.dirname(directory);
    if(!existsSync(path.join(directory,'package.json')))continue;
    const dependency=JSON.parse(await fs.readFile(path.join(directory,'package.json'),'utf8'));
    if(!dependency.name||dependencies.has(dependency.name))continue;
    const licenses=(await fs.readdir(directory)).filter(name=>/^(license|copying|notice)(\.|$)/i.test(name));
    const contents=await Promise.all(licenses.map(async name=>`${name}\n${await fs.readFile(path.join(directory,name),'utf8')}`));
    dependencies.set(dependency.name,{version:dependency.version,license:dependency.license||'NOT_DECLARED',contents:contents.join('\n')});
}
await fs.writeFile(path.join(target,'THIRD_PARTY_LICENSES.txt'),[...dependencies].sort(([a],[b])=>a.localeCompare(b)).map(([name,value])=>`${name} ${value.version} — ${value.license}\n${value.contents||'License declaration from package.json; SDK modules inherit the accompanying Univer LICENSE.'}`).join('\n\n----\n\n')+'\n');
await fs.writeFile(path.join(target,'NOTICE'),'Univer 1.0.3 (Apache-2.0), SDK commit 748661cbe4c4206c8e188fe0b18ea371a6909776.\nLocally built read-only bridge; no Pro, cloud conversion, XLSX or server service.\nThird-party package declarations and license notices: THIRD_PARTY_LICENSES.txt.\n');
