// Use the tokenizer without Prism rewriting the page's code blocks.
const runtime = globalThis as { Prism?: { manual?: boolean; disableWorkerMessageHandler?: boolean; }; };
runtime.Prism ??= {};
runtime.Prism.manual = true;
runtime.Prism.disableWorkerMessageHandler = true;
export { };
