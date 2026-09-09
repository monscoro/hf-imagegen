import { type PluginContext } from "@lmstudio/sdk";
import { toolsProvider } from "./toolsProvider";
import { promptPreprocessor } from "./promptPreprocessor";
import { pluginConfigSchematics } from "./config";

export async function main(context: PluginContext) {
  context.withConfigSchematics(pluginConfigSchematics);
  context.withToolsProvider(toolsProvider);
  context.withPromptPreprocessor(promptPreprocessor);
}
