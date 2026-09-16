// Optional providers must never prevent unrelated providers from loading.
export function createKoboldSettingsReader(loadSettings) {
    let settingsPromise;
    return async function getKoboldCppUrl() {
        settingsPromise ??= Promise.resolve().then(loadSettings).catch(() => null);
        const settings = await settingsPromise;
        const type = settings?.textgen_types?.KOBOLDCPP;
        const url = type ? settings?.textgenerationwebui_settings?.server_urls?.[type] : null;
        return typeof url === 'string' && url.trim() ? url : null;
    };
}
