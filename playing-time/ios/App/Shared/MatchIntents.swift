// Interactive Live Activity buttons (iOS 17+).
// Target Membership: App + MatchWidget. LiveActivityIntent.perform() runs in the APP's process,
// so it can write the shared store and wake the Capacitor plugin.
import Foundation
#if canImport(ActivityKit) && canImport(AppIntents)
import ActivityKit
import AppIntents

extension Notification.Name {
    static let matchActionQueued = Notification.Name("mt.melitafc.playingtime.actionQueued")
}

@available(iOS 17.0, *)
enum MatchActivityUpdater {
    static func push(_ s: MatchClockState) async {
        for activity in Activity<MatchActivityAttributes>.activities {
            await activity.update(ActivityContent(state: s, staleDate: nil))
        }
    }
}

@available(iOS 17.0, *)
struct StartPeriodIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Start"
    static var description = IntentDescription("Start the match clock / next period.")
    init() {}
    func perform() async throws -> some IntentResult {
        let now = Date().timeIntervalSince1970 * 1000
        if let s = MatchStore.apply("start", at: now) {
            await MatchActivityUpdater.push(s)
            NotificationCenter.default.post(name: .matchActionQueued, object: nil)
        }
        return .result()
    }
}

@available(iOS 17.0, *)
struct EndPeriodIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Period"
    static var description = IntentDescription("End the current period and pause the clock.")
    init() {}
    func perform() async throws -> some IntentResult {
        let now = Date().timeIntervalSince1970 * 1000
        if let s = MatchStore.apply("period", at: now) {
            await MatchActivityUpdater.push(s)
            NotificationCenter.default.post(name: .matchActionQueued, object: nil)
        }
        return .result()
    }
}
#endif
