// Local SDK bridge. Business calculations and persistence remain in STCT.
import { createUniver } from '@univerjs/presets';
import { CommandType, LocaleType } from '@univerjs/core';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import zhCN from '@univerjs/preset-sheets-core/locales/zh-CN';

export const version = '1.0.3';
let current: { dispose(): void; read(): object; selection(): unknown[][] } | null = null;
let generation = 0;
export function read() { return current?.read() ?? null; }
export async function mount(container: HTMLElement, data: object) {
    current?.dispose();
    const mine = ++generation;
    const host = document.createElement('div');
    host.style.cssText = 'height:100%;width:100%';
    container.replaceChildren(host);
    // Native style boundary: legacy global aside/section/button styles cannot alter the SDK layout.
    const shadow = host.attachShadow({ mode: 'open' });
    const sheet = document.createElement('link');
    sheet.rel = 'stylesheet';
    sheet.href = new URL('./vendor/univer/report.css', document.baseURI).href;
    const surface = document.createElement('div');
    surface.style.cssText = 'height:100%;width:100%;color:#202734;font:14px system-ui';
    await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('UNIVER_STYLE_TIMEOUT')), 15000);
        sheet.onload = () => { clearTimeout(timer); resolve(); };
        sheet.onerror = () => { clearTimeout(timer); reject(new Error('UNIVER_STYLE_FAILED')); };
        shadow.append(sheet, surface);
    }).catch(error => { host.remove(); throw error; });
    if (mine !== generation || !container.isConnected) { host.remove(); throw new Error('UNIVER_LOAD_CANCELED'); }
    const { univer, univerAPI } = createUniver({
        locale: LocaleType.ZH_CN,
        locales: { [LocaleType.ZH_CN]: zhCN },
        presets: [UniverSheetsCorePreset({ container: surface, header: false, toolbar: false,
            formulaBar: false, contextMenu: false, disableAutoFocus: true,
            formula: { initialFormulaComputing: false } })],
    });
    try {
        const workbook = univerAPI.createWorkbook(data);
        workbook.setEditable(false);
        // Permissions protect native UI; mutations are also refused at the command boundary.
        const guard = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, event => {
            if (event.type === CommandType.MUTATION) event.cancel = true;
        });
        let disposed = false;
        current = {
            read() { return workbook.save(); },
            selection() { return workbook.getActiveRange()?.getValues() ?? []; },
            dispose() {
                if (disposed) return;
                disposed = true;
                guard.dispose();
                univer.dispose();
                container.replaceChildren();
                current = null;
            },
        };
        return current;
    } catch (error) {
        univer.dispose();
        container.replaceChildren();
        throw error;
    }
}
