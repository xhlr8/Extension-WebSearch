export class StaleChatError extends Error {
    constructor() { super('The chat changed or this request was superseded. Its results were discarded.'); this.name = 'StaleChatError'; this.code = 'STALE_CHAT'; }
}

const identity = context => JSON.stringify([context.characterId, context.groupId, context.getCurrentChatId?.() || context.chatId]);

/** Capture object identity as well as names: navigating away and back must invalidate old work. */
export function createChatTracker(getContext) {
    let revision = 0;
    const active = new Set();
    function capture() {
        const initial = getContext();
        const key = identity(initial), chat = initial.chat, metadata = initial.chatMetadata;
        const epoch = revision;
        const controller = new AbortController();
        let messageCheck = null, trackedIndex = null;
        const guard = {
            signal: controller.signal,
            cancel() { controller.abort(new StaleChatError()); active.delete(guard); },
            assert() {
                const current = getContext();
                if (controller.signal.aborted || epoch !== revision || identity(current) !== key || current.chat !== chat || current.chatMetadata !== metadata || (messageCheck && !messageCheck(current))) {
                    guard.cancel(); throw new StaleChatError();
                }
                return current;
            },
            bindMessage(index) {
                const current = guard.assert();
                const message = current.chat?.[index];
                if (!Number.isInteger(index) || index < 0 || !message) { guard.cancel(); throw new StaleChatError(); }
                trackedIndex = index;
                const text = message.mes, swipe = message.swipe_id;
                messageCheck = ctx => ctx.chat?.[index] === message && message.mes === text && message.swipe_id === swipe;
                return message;
            },
            commit(action) {
                guard.assert();
                messageCheck = null;
                try { action(); } finally { if (trackedIndex !== null) guard.bindMessage(trackedIndex); }
            },
            release() { active.delete(guard); },
        };
        active.add(guard);
        return guard;
    }
    return {
        capture,
        invalidate() { revision++; for (const guard of active) guard.cancel(); active.clear(); },
    };
}
