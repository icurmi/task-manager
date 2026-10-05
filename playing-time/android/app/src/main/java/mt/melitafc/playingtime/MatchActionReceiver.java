package mt.melitafc.playingtime;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Handles START / PERIOD taps on the notification – works with the phone locked and the app suspended. */
public class MatchActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (action == null) return;
        String type = action.substring(action.lastIndexOf('.') + 1);
        long at = System.currentTimeMillis();
        if (MatchStore.apply(context, type, at) != null) {
            MatchService.repost(context);
            MatchControlPlugin.notifyPending();
        }
    }
}
