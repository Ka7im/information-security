import type { Profile } from '@app/shared';
interface ProfileCardProps {
  profile: Profile;
  disabled: boolean;
  onLogout: () => Promise<void>;
}
export function ProfileCard({ profile, disabled, onLogout }: ProfileCardProps) {
  return (
    <>
      <div className="profile-row">
        <span>Логин</span>
        <strong>{profile.login}</strong>
      </div>
      <div className="profile-row">
        <span>Telegram</span>
        <strong>@{profile.telegramLogin}</strong>
      </div>
      <div className="actions">
        <button className="secondary" disabled={disabled} onClick={() => void onLogout()}>
          Выйти
        </button>
      </div>
    </>
  );
}
