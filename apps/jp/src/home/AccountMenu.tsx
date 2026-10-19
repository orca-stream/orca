import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";
import { FocusContext, useFocusable } from "@noriginmedia/norigin-spatial-navigation-react";
import { useEffect } from "react";
import { t } from "../i18n/locale";
import { sessionId, type Session } from "../jellyfin/session";
import { FocusButton } from "../navigation/Focusable";
import { Avatar } from "../profiles/Avatar";
import { LinkDeviceIcon, PencilIcon } from "../ui/icons";

export interface Account {
  session: Session;
  /** Every profile on the device, the current one included. */
  profiles: Session[];
  onPickProfile: (session: Session) => void;
  onManageProfiles: () => void;
  /** Approve a TV or Xbox's Quick Connect code as this profile. */
  onLinkDevice: () => void;
  onSignOut: () => void;
}

/** Netflix web's menu rows: 53 px tall, 4 px in from the sides, a rounded grey row on hover. */
const ITEM =
  "flex h-[53px] w-full items-center gap-4 rounded-lg px-3.5 text-left text-[16px] text-white/85 outline-none hover:bg-white/15 hover:text-white focused:bg-white focused:text-black";

interface Props {
  account: Account;
  onClose: () => void;
  /** The button that opened the menu, focused again when it closes with Escape or Back. */
  openerKey: string;
  /** Where the menu sits next to its button: under it in the header, over it in the tab bar. */
  className: string;
}

/** Other profiles, profile management and sign out: Netflix's avatar menu. */
export function AccountMenu({ account, onClose, openerKey, className }: Props) {
  const others = account.profiles.filter(
    (profile) => sessionId(profile) !== sessionId(account.session),
  );
  // A boundary keeps the arrows inside the open menu; Escape or Back closes it.
  const { ref, focusKey, focusSelf } = useFocusable({
    focusKey: "ACCOUNT_MENU",
    isFocusBoundary: true,
  });

  useEffect(() => {
    focusSelf();
    function close(event: KeyboardEvent) {
      if (event.key !== "Escape" && event.key !== "GoBack" && event.key !== "BrowserBack") return;
      event.preventDefault();
      onClose();
      void setFocus(openerKey);
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [focusSelf, onClose, openerKey]);

  return (
    <FocusContext.Provider value={focusKey}>
      <div aria-hidden="true" className="fixed inset-0" onClick={onClose} />
      <div
        ref={ref}
        role="menu"
        aria-label={t.account.menu}
        className={`absolute z-10 grid w-[274px] rounded-lg border border-white/10 bg-[#232323] p-1 shadow-2xl ${className}`}
      >
        {others.map((profile) => (
          <FocusButton
            key={sessionId(profile)}
            role="menuitem"
            className={ITEM}
            onPress={() => account.onPickProfile(profile)}
          >
            <Avatar session={profile} className="size-9 flex-none rounded-[4px] text-base" />
            <span className="truncate">{profile.userName}</span>
          </FocusButton>
        ))}
        <FocusButton role="menuitem" className={ITEM} onPress={account.onManageProfiles}>
          <PencilIcon className="size-[26px] flex-none" strokeWidth={1.5} />
          {t.account.manageProfiles}
        </FocusButton>
        <FocusButton role="menuitem" className={ITEM} onPress={account.onLinkDevice}>
          <LinkDeviceIcon className="size-[26px] flex-none" strokeWidth={1.5} />
          {t.account.linkDevice}
        </FocusButton>
        {/* As on Netflix: sign out last, under a rule, as plain text. */}
        <hr className="-mx-1 my-1 border-white/[0.07]" />
        <FocusButton role="menuitem" className={ITEM} onPress={account.onSignOut}>
          {t.account.signOut}
        </FocusButton>
      </div>
    </FocusContext.Provider>
  );
}
