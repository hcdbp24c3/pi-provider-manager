// pi-provider-manager — manage OpenAI-compatible providers via /provider commands
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  cmdAdd, cmdList, cmdEdit, cmdDelete, cmdUpdateModels, autoUpdateProviders, requireUI,
} from "./commands.ts";

export default function (pi: ExtensionAPI) {
  pi.registerCommand("provider", {
    description: "Manage OpenAI-compatible providers: add, list, edit, delete, update-models",
    handler: async (args, ctx) => {
      const [sub, ...rest] = (args ?? "").trim().split(/\s+/);
      const name = rest.join(" ");
      switch (sub) {
        case "add": return cmdAdd(pi, name, ctx);
        case "list": case "ls": return cmdList(pi, ctx);
        case "edit": return cmdEdit(pi, name, ctx);
        case "delete": case "rm": case "remove": return cmdDelete(pi, name, ctx);
        case "update-models": case "refresh": return cmdUpdateModels(pi, name, ctx);
        default:
          if (requireUI(ctx)) ctx.ui.notify("Usage: /provider add|list|edit|delete|update-models [name]", "info");
      }
    },
  });

  pi.on("session_start", async (event, ctx) => {
    if (event.reason === "startup") {
      await autoUpdateProviders(pi, ctx);
    }
  });
}