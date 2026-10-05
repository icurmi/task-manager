package mt.melitafc.playingtime;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Tiny mirror of the match clock + a queue of lock-screen taps, persisted in SharedPreferences.
 * Timestamps, never counters: the clock is correct however long the app/WebView is suspended.
 */
final class MatchStore {
    private static final String PREFS = "match_control";

    static final class State {
        String matchId = "";
        String title = "";
        int period = 0;
        String phase = "pre"; // pre | running | break | ended
        double bankedMs = 0;
        Double runningSince = null; // epoch ms

        JSONObject toJson() throws JSONException {
            JSONObject o = new JSONObject();
            o.put("matchId", matchId).put("title", title).put("period", period).put("phase", phase).put("bankedMs", bankedMs);
            if (runningSince != null) o.put("runningSince", runningSince);
            return o;
        }

        static State fromJson(JSONObject o) {
            State s = new State();
            s.matchId = o.optString("matchId", "");
            s.title = o.optString("title", "");
            s.period = o.optInt("period", 0);
            s.phase = o.optString("phase", "pre");
            s.bankedMs = o.optDouble("bankedMs", 0);
            s.runningSince = o.has("runningSince") && !o.isNull("runningSince") ? o.optDouble("runningSince") : null;
            return s;
        }

        /** Wall-clock epoch ms at which the match clock read 00:00. */
        long clockZero() {
            return (long) ((runningSince != null ? runningSince : System.currentTimeMillis()) - bankedMs);
        }

        String bankedText() {
            long secs = (long) (bankedMs / 1000);
            return String.format(java.util.Locale.ROOT, "%02d:%02d", secs / 60, secs % 60);
        }
    }

    private static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static synchronized State load(Context c) {
        String raw = prefs(c).getString("clock", null);
        if (raw == null) return null;
        try {
            return State.fromJson(new JSONObject(raw));
        } catch (JSONException e) {
            return null;
        }
    }

    static synchronized void save(Context c, State s) {
        try {
            if (s == null) prefs(c).edit().remove("clock").commit();
            else prefs(c).edit().putString("clock", s.toJson().toString()).commit();
        } catch (JSONException ignored) {
        }
    }

    static synchronized JSONArray queue(Context c) {
        try {
            return new JSONArray(prefs(c).getString("queue", "[]"));
        } catch (JSONException e) {
            return new JSONArray();
        }
    }

    static synchronized JSONArray drain(Context c) {
        JSONArray q = queue(c);
        prefs(c).edit().remove("queue").commit();
        return q;
    }

    /** Same rules as the JS engine. Returns the new state, or null if the tap is not valid now. */
    static synchronized State apply(Context c, String type, long at) {
        State s = load(c);
        if (s == null) return null;
        if ("start".equals(type) && ("pre".equals(s.phase) || "break".equals(s.phase))) {
            s.period += 1;
            s.phase = "running";
            s.runningSince = (double) at;
        } else if ("period".equals(type) && "running".equals(s.phase)) {
            s.bankedMs += Math.max(0, at - s.runningSince);
            s.runningSince = null;
            s.phase = "break";
        } else {
            return null;
        }
        save(c, s);
        try {
            JSONArray q = queue(c);
            q.put(new JSONObject().put("type", type).put("at", at));
            prefs(c).edit().putString("queue", q.toString()).commit();
        } catch (JSONException ignored) {
        }
        return s;
    }

    private MatchStore() {}
}
