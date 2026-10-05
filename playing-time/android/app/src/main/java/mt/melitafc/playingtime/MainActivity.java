package mt.melitafc.playingtime;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MatchControlPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
