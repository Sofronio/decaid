import 'device.dart';

abstract class Grinder extends Device {
  Stream<GrinderSnapshot> get currentSnapshot;

  Future<void> start();
  Future<void> stop();
  Future<void> setGrindSection({int? index, String? name});
  Future<void> setPreset({String? uid, int? index});
  Future<void> setFeedingRpm(int rpm);
  Future<void> setGrindRpm(int rpm);
  Future<void> setBladeGap(int micrometers);
  Future<void> setBrightness(int level);
  Future<void> setStandbySec(int seconds);
  Future<void> setCupDetect(bool enabled);
  Future<void> setAutoStop(bool enabled);
  Future<void> setFastClean(bool enabled);
  Future<void> reboot();
}

enum GrinderDevState { idle, grinding, highspeedClean, unknown }

class GrinderPreset {
  final String uid;
  final String name;

  const GrinderPreset({required this.uid, required this.name});

  Map<String, dynamic> toJson() => {'uid': uid, 'name': name};
}

class GrindSection {
  final int index;
  final String name;

  const GrindSection({required this.index, required this.name});

  Map<String, dynamic> toJson() => {'index': index, 'name': name};
}

class GrinderSnapshot {
  final DateTime timestamp;
  final GrinderDevState devState;
  final int? feedingRpm;
  final int? grindRpm;
  final int? bladeGap;
  final int? humidity;
  final int? totalGrinds;
  final bool? cupDetect;
  final bool? autoStop;
  final bool? fastClean;
  final int? brightness;
  final int? standbySec;
  final String? wifiName;
  final String? netState;
  final String? snCode;
  final String? resetReason;
  final String? releaseVer;
  final List<GrinderPreset> presets;
  final List<GrindSection> grindSections;

  const GrinderSnapshot({
    required this.timestamp,
    required this.devState,
    this.feedingRpm,
    this.grindRpm,
    this.bladeGap,
    this.humidity,
    this.totalGrinds,
    this.cupDetect,
    this.autoStop,
    this.fastClean,
    this.brightness,
    this.standbySec,
    this.wifiName,
    this.netState,
    this.snCode,
    this.resetReason,
    this.releaseVer,
    this.presets = const [],
    this.grindSections = const [],
  });

  Map<String, dynamic> toJson() {
    return {
      'timestamp': timestamp.toIso8601String(),
      'devState': devState.name,
      'feedingRpm': feedingRpm,
      'grindRpm': grindRpm,
      'bladeGap': bladeGap,
      'humidity': humidity,
      'totalGrinds': totalGrinds,
      'cupDetect': cupDetect,
      'autoStop': autoStop,
      'fastClean': fastClean,
      'brightness': brightness,
      'standbySec': standbySec,
      'wifiName': wifiName,
      'netState': netState,
      'snCode': snCode,
      'resetReason': resetReason,
      'releaseVer': releaseVer,
      'presets': presets.map((p) => p.toJson()).toList(),
      'grindSections': grindSections.map((s) => s.toJson()).toList(),
    };
  }
}
