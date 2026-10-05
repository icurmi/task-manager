// Capacitor plugin "MatchControl": mirrors the match clock into a Live Activity
// (lock screen + Dynamic Island) and hands lock-screen taps back to the web app.
import Capacitor
import Foundation
#if canImport(ActivityKit)
import ActivityKit
#endif

@objc(MatchControlPlugin)
public class MatchControlPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MatchControlPlugin"
    public let jsName = "MatchControl"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "startSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "updateSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "endSession", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "drainActions", returnType: CAPPluginReturnPromise),
    ]

    private var observer: NSObjectProtocol?

    override public func load() {
        observer = NotificationCenter.default.addObserver(
            forName: Notification.Name("mt.melitafc.playingtime.actionQueued"), object: nil, queue: .main
        ) { [weak self] _ in
            self?.notifyListeners("actionsPending", data: [:])
        }
    }

    deinit {
        if let observer { NotificationCenter.default.removeObserver(observer) }
    }

    private func state(from call: CAPPluginCall) -> MatchClockState? {
        guard let matchId = call.getString("matchId") else { return nil }
        let rs = call.getDouble("runningSince")
        return MatchClockState(
            matchId: matchId,
            title: call.getString("title") ?? "",
            period: call.getInt("period") ?? 0,
            phase: call.getString("phase") ?? "pre",
            bankedMs: call.getDouble("bankedMs") ?? 0,
            runningSince: rs
        )
    }

    @objc func startSession(_ call: CAPPluginCall) {
        guard let s = state(from: call) else { return call.reject("matchId required") }
        // Never clobber lock-screen taps that the app hasn't drained yet.
        if !MatchStore.queue().isEmpty, let existing = MatchStore.load(), existing.matchId == s.matchId {
            call.resolve(); return
        }
        MatchStore.save(s)
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                let existing = Activity<MatchActivityAttributes>.activities.first { $0.attributes.matchId == s.matchId }
                if let existing {
                    await existing.update(ActivityContent(state: s, staleDate: nil))
                } else if ActivityAuthorizationInfo().areActivitiesEnabled {
                    for a in Activity<MatchActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
                    _ = try? Activity.request(
                        attributes: MatchActivityAttributes(matchId: s.matchId),
                        content: ActivityContent(state: s, staleDate: nil),
                        pushType: nil
                    )
                }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    @objc func updateSession(_ call: CAPPluginCall) {
        guard let s = state(from: call) else { return call.reject("matchId required") }
        // If taps are waiting, the native state is ahead of JS – let JS drain first.
        if !MatchStore.queue().isEmpty { return call.resolve() }
        MatchStore.save(s)
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                for a in Activity<MatchActivityAttributes>.activities where a.attributes.matchId == s.matchId {
                    await a.update(ActivityContent(state: s, staleDate: nil))
                }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    @objc func endSession(_ call: CAPPluginCall) {
        MatchStore.save(nil)
        _ = MatchStore.drain()
        #if canImport(ActivityKit)
        if #available(iOS 16.2, *) {
            Task {
                for a in Activity<MatchActivityAttributes>.activities { await a.end(nil, dismissalPolicy: .immediate) }
                call.resolve()
            }
            return
        }
        #endif
        call.resolve()
    }

    @objc func drainActions(_ call: CAPPluginCall) {
        let actions = MatchStore.drain().map { ["type": $0.type, "at": $0.at] as [String: Any] }
        call.resolve(["actions": actions])
    }
}
