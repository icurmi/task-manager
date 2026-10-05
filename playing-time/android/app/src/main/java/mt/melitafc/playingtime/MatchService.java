package mt.melitafc.playingtime;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Ongoing foreground-service notification: live match clock (system Chronometer, so it ticks
 * even if our process is frozen) with START / PERIOD / Sub actions, visible on the lock screen.
 */
public class MatchService extends Service {
    static final String CHANNEL = "match_clock";
    static final int NOTIF_ID = 1414;
    static final String ACTION_REFRESH = "mt.melitafc.playingtime.REFRESH";

    static void refresh(Context c) {
        Intent i = new Intent(c, MatchService.class).setAction(ACTION_REFRESH);
        if (Build.VERSION.SDK_INT >= 26) c.startForegroundService(i);
        else c.startService(i);
    }

    /** Update the existing ongoing notification in place (safe from a background broadcast). */
    static void repost(Context c) {
        MatchStore.State s = MatchStore.load(c);
        if (s == null) return;
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        nm.notify(NOTIF_ID, build(c, s));
    }

    static void stop(Context c) {
        c.stopService(new Intent(c, MatchService.class));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        MatchStore.State s = MatchStore.load(this);
        if (s == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        Notification n = build(this, s);
        int type = Build.VERSION.SDK_INT >= 34 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
        ServiceCompat.startForeground(this, NOTIF_ID, n, type);
        return START_STICKY; // restarted by the OS with the persisted state if killed
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    static Notification build(Context c, MatchStore.State s) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Match clock", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Live match clock with START / PERIOD controls");
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("playingtime://match/" + s.matchId), c, MainActivity.class);
        Intent sub = new Intent(Intent.ACTION_VIEW, Uri.parse("playingtime://match/" + s.matchId + "?sub=1"), c, MainActivity.class);

        boolean running = "running".equals(s.phase);
        String status = running ? "PERIOD " + s.period
                : "break".equals(s.phase) ? "BREAK after P" + s.period + " · " + s.bankedText()
                : "READY · press START";

        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
                .setContentTitle(s.title)
                .setContentText(status)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
                .setContentIntent(PendingIntent.getActivity(c, 1, open, piFlags));

        if (running) {
            b.setUsesChronometer(true).setShowWhen(true).setWhen(s.clockZero());
            b.addAction(0, "PERIOD", actionIntent(c, "period"));
        } else {
            b.setUsesChronometer(false).setShowWhen(false);
            b.addAction(0, s.period == 0 ? "START" : "START P" + (s.period + 1), actionIntent(c, "start"));
        }
        b.addAction(0, "Sub", PendingIntent.getActivity(c, 2, sub, piFlags));
        return b.build();
    }

    private static PendingIntent actionIntent(Context c, String type) {
        Intent i = new Intent(c, MatchActionReceiver.class).setAction("mt.melitafc.playingtime." + type);
        return PendingIntent.getBroadcast(c, type.hashCode(), i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }
}
