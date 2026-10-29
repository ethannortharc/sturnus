// zellij-jump: what Zellij's command line cannot do, by pipe — focus a pane by its id, in this session or in another
// (switching the client there), and name a pane by its id.
//   zellij --session S pipe --plugin file:<this>.wasm -- "focus <pane_id>"            a pane of S itself
//   zellij --session S pipe --plugin file:<this>.wasm -- "switch <session> <pane_id>"  S's client goes to another session
//   zellij --session S pipe --plugin file:<this>.wasm -- "rename <pane_id> <name>"
//   zellij --session S pipe --plugin file:<this>.wasm -- "share"                       S may be opened in the browser
//   zellij --session S pipe --plugin file:<this>.wasm -- "type <pane_id> <text>"       text into a pane, as if typed
//   zellij --session S pipe --plugin file:<this>.wasm -- "enter <pane_id>"             the Enter key in a pane
//   zellij --session S pipe --plugin file:<this>.wasm -- "tidy"                        close the other zellij-jump panes in S
// Zellij runs a plugin once per client and hands a pipe to each: "@<client> <command>" is done by that client's alone
// (and a focus moves that client only).
use std::collections::BTreeMap;
use zellij_tile::prelude::*;

#[derive(Default)]
struct Jump {
    panes: Option<PaneManifest>,
    tidy: bool,
}
register_plugin!(Jump);

impl ZellijPlugin for Jump {
    fn load(&mut self, _config: BTreeMap<String, String>) {
        // (always the same set: Zellij keeps one grant per plugin path, and each grant replaces the one before)
        subscribe(&[EventType::PermissionRequestResult, EventType::PaneUpdate]);  // (first: an answer can come at once)
        request_permission(&[PermissionType::ChangeApplicationState, PermissionType::ReadApplicationState, PermissionType::ReadCliPipes,
                             PermissionType::WriteToStdin, PermissionType::StartWebServer]);
    }

    fn update(&mut self, event: Event) -> bool {
        match event {
            // (Zellij shows a plugin that asks for permission as a floating pane; once answered it has nothing to show)
            Event::PermissionRequestResult(_) => hide_self(),
            Event::PaneUpdate(panes) => { self.panes = Some(panes); self.do_tidy(); }
            _ => {}
        }
        false
    }

    fn pipe(&mut self, msg: PipeMessage) -> bool {
        hide_self();  // (a pipe launches it as a floating pane; it has nothing to show)
        let said = msg.payload.clone().unwrap_or_default();
        let (target, said) = match said.strip_prefix('@').and_then(|r| r.split_once(' ')) {
            Some((c, rest)) => (c.parse::<ClientId>().ok(), rest.to_string()),
            None => (None, said),
        };
        if target.is_some_and(|c| c != get_plugin_ids().client_id) {
            return false;
        }
        let words: Vec<&str> = said.splitn(3, ' ').collect();
        let answer = match words.as_slice() {
            ["focus", id] => match id.trim().parse::<u32>() {
                Ok(id) => { focus_terminal_pane(id, false); "ok".to_string() }
                Err(_) => format!("bad pane id {id}"),
            },
            ["switch", session, id] => match id.trim().parse::<u32>() {
                Ok(id) => { switch_session_with_focus(session, None, Some((id, false))); "ok".to_string() }
                Err(_) => format!("bad pane id {id}"),
            },
            ["share"] => { share_current_session(); "ok".to_string() }
            ["type", id, text] => match id.parse::<u32>() {
                Ok(id) => { write_chars_to_pane_id(text, PaneId::Terminal(id)); "ok".to_string() }
                Err(_) => format!("bad pane id {id}"),
            },
            ["enter", id] => match id.trim().parse::<u32>() {
                Ok(id) => { write_to_pane_id(vec![b'\r'], PaneId::Terminal(id)); "ok".to_string() }
                Err(_) => format!("bad pane id {id}"),
            },
            ["rename", id, name] => match id.parse::<u32>() {
                Ok(id) => { rename_terminal_pane(id, name); "ok".to_string() }
                Err(_) => format!("bad pane id {id}"),
            },
            ["tidy"] => { self.tidy = true; self.do_tidy(); "ok".to_string() }
            _ => format!("unknown: {said}"),
        };
        if let PipeSource::Cli(pipe_id) = &msg.source {
            cli_pipe_output(pipe_id, &format!("{answer}\n"));
            unblock_cli_pipe_input(pipe_id);
        }
        false
    }
}

impl Jump {
    fn do_tidy(&mut self) {
        let Some(m) = &self.panes else { return };
        if !self.tidy { return }
        self.tidy = false;
        let me = get_plugin_ids().plugin_id;
        for p in m.panes.values().flatten() {
            if p.is_plugin && p.id != me && p.plugin_url.as_deref().is_some_and(|u| u.ends_with("zellij-jump.wasm")) {
                close_plugin_pane(p.id);
            }
        }
    }
}
