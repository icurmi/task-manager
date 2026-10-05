import Capacitor
import UIKit

/// Registers the app-local MatchControl plugin with the Capacitor bridge.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(MatchControlPlugin())
    }
}
