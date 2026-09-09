"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const toolsProvider_1 = require("./toolsProvider");
const promptPreprocessor_1 = require("./promptPreprocessor");
const config_1 = require("./config");
async function main(context) {
    context.withConfigSchematics(config_1.pluginConfigSchematics);
    context.withToolsProvider(toolsProvider_1.toolsProvider);
    context.withPromptPreprocessor(promptPreprocessor_1.promptPreprocessor);
}
