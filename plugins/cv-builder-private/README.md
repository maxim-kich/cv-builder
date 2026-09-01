# CV Builder Private plugin package

This source package supplies ChatGPT/Codex presentation metadata and test prompts for one private,
registered CV Builder MCP connection. The connection itself is created in the owner's ChatGPT
account so its technical `plugin_asdk_app...` ID cannot safely be pre-filled in source control.

After registering the deployment URL in ChatGPT developer mode, run:

```sh
node scripts/configure-app.mjs \
  --app-id plugin_asdk_app_REPLACE_WITH_THE_REGISTERED_ID \
  --base-url https://cv-builder.maximkich.com \
  --owner Maxim
```

Use Valeriia's URL and owner name in her separate checkout/account. The script creates `.app.json`
and points `.codex-plugin/plugin.json` at it. `.app.json` is intentionally git-ignored because it is
an account-specific connection mapping. It contains no OAuth token or database credential.

Validate the configured package from the plugin-creator skill directory:

```sh
python3 scripts/validate_plugin.py /absolute/path/to/plugins/cv-builder-private
```

See [test-prompts.md](test-prompts.md) for the cross-surface acceptance set.
