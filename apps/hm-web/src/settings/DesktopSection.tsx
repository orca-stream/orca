import { useEffect, useState } from "react";
import { Alert02Icon, GpuIcon, RefreshIcon } from "@hugeicons/core-free-icons";
import type { DesktopBridge, HardwareAcceleration } from "@orca/hm-contract/desktop";
import { desktopBridge } from "@/desktop/bridge";
import { useT } from "@/i18n/locale";
import { Group, NoteRow, PanelButton, ToggleRow } from "./rows";

/**
 * What only the desktop app has: drawing with the GPU. The choice is saved at once; Chromium takes it
 * only at start, so while it differs from what this run uses, the panel offers to restart the app.
 * In a browser there is nothing to show.
 */
export function DesktopSection() {
  const desktop = desktopBridge();
  return desktop ? <HardwareAccelerationGroup desktop={desktop} /> : null;
}

function HardwareAccelerationGroup({ desktop }: { desktop: DesktopBridge }) {
  const t = useT();
  const [state, setState] = useState<HardwareAcceleration | null>(null);
  const [failed, setFailed] = useState<boolean | null>(null);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    let current = true;
    void desktop
      .hardwareAcceleration()
      .then((next) => current && setState(next))
      .catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
  }, [desktop]);

  if (!state) return null;
  const store = (enabled: boolean) => {
    setState({ ...state, enabled });
    setFailed(null);
    desktop
      .setHardwareAcceleration(enabled)
      .then(setState)
      .catch(() => setFailed(enabled));
  };

  return (
    <Group title={t.settings.desktop.title} description={t.settings.desktop.description}>
      <ToggleRow
        icon={GpuIcon}
        label={t.settings.desktop.hardwareAcceleration}
        checked={state.enabled}
        onChange={store}
      />
      {typeof failed === "boolean" ? (
        <NoteRow
          icon={Alert02Icon}
          tone="warning"
          action={
            <PanelButton variant="outline" onClick={() => store(failed)}>
              {t.common.retry}
            </PanelButton>
          }
        >
          <p role="alert">{t.settings.desktop.saveFailed}</p>
        </NoteRow>
      ) : (
        state.enabled !== state.active && (
          <NoteRow
            icon={RefreshIcon}
            action={
              <PanelButton
                pending={restarting}
                onClick={() => {
                  setRestarting(true);
                  desktop.restart();
                }}
              >
                {t.settings.desktop.restart}
              </PanelButton>
            }
          >
            <p role="status">{t.settings.desktop.restartNote}</p>
          </NoteRow>
        )
      )}
    </Group>
  );
}
