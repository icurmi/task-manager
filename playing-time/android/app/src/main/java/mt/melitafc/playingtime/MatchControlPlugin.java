package mt.melitafc.playingtime;

import android.Manifest;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.ref.WeakReference;
import org.json.JSONArray;

@CapacitorPlugin(name = "MatchControl")
public class MatchControlPlugin extends Plugin {
    private static WeakReference<MatchControlPlugin> instance = new WeakReference<>(null);

    static void notifyPending() {
        MatchControlPlugin p = instance.get();
        if (p != null) p.notifyListeners("actionsPending", new JSObject());
    }

    @Override
    public void load() {
        instance = new WeakReference<>(this);
    }

    private MatchStore.State read(PluginCall call) {
        MatchStore.State s = new MatchStore.State();
        s.matchId = call.getString("matchId", "");
        s.title = call.getString("title", "");
        s.period = call.getInt("period", 0);
        s.phase = call.getString("phase", "pre");
        s.bankedMs = call.getDouble("bankedMs", 0.0);
        Object rs = call.getData().opt("runningSince");
        s.runningSince = rs instanceof Number ? ((Number) rs).doubleValue() : null;
        return s;
    }

    @PluginMethod
    public void startSession(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33
                && ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                && getActivity() != null) {
            ActivityCompat.requestPermissions(getActivity(), new String[] {Manifest.permission.POST_NOTIFICATIONS}, 4141);
        }
        save(call);
    }

    @PluginMethod
    public void updateSession(PluginCall call) {
        save(call);
    }

    private void save(PluginCall call) {
        MatchStore.State s = read(call);
        // Taps waiting to be drained mean native is ahead of JS – don't overwrite.
        if (MatchStore.queue(getContext()).length() == 0) MatchStore.save(getContext(), s);
        MatchService.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void endSession(PluginCall call) {
        MatchStore.save(getContext(), null);
        MatchStore.drain(getContext());
        MatchService.stop(getContext());
        call.resolve();
    }

    @PluginMethod
    public void drainActions(PluginCall call) {
        JSONArray q = MatchStore.drain(getContext());
        JSObject ret = new JSObject();
        try {
            ret.put("actions", new JSArray(q.toString()));
        } catch (Exception e) {
            ret.put("actions", new JSArray());
        }
        call.resolve(ret);
    }
}
