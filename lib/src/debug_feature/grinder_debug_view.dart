import 'package:flutter/material.dart';
import 'package:reaprime/src/models/device/grinder.dart';
import 'package:shadcn_ui/shadcn_ui.dart';

class GrinderDebugView extends StatefulWidget {
  final Grinder grinder;

  const GrinderDebugView({super.key, required this.grinder});

  @override
  State<GrinderDebugView> createState() => _GrinderDebugViewState();
}

class _GrinderDebugViewState extends State<GrinderDebugView> {
  @override
  void initState() {
    super.initState();
    widget.grinder.onConnect();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ShadTheme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Grinder Debug'),
        leading: IconButton(
          icon: const Icon(LucideIcons.arrowLeft),
          onPressed: () => Navigator.of(context).pop(),
        ),
        actions: [
          ShadButton.destructive(
            size: ShadButtonSize.sm,
            child: const Text('Disconnect'),
            onPressed: () async {
              await widget.grinder.disconnect();
              if (!context.mounted) return;
              Navigator.of(context).pop();
            },
          ),
        ],
      ),
      body: StreamBuilder<GrinderSnapshot>(
        stream: widget.grinder.currentSnapshot,
        builder: (context, snapshot) {
          if (snapshot.connectionState == ConnectionState.active) {
            return _buildActiveView(theme, snapshot.data!);
          } else if (snapshot.connectionState == ConnectionState.waiting) {
            return Center(
              child: Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  ),
                  const SizedBox(width: 12),
                  Text('Connecting…', style: theme.textTheme.muted),
                ],
              ),
            );
          }
          return Center(
            child: Text('Disconnected', style: theme.textTheme.muted),
          );
        },
      ),
    );
  }

  Widget _buildActiveView(ShadThemeData theme, GrinderSnapshot s) {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        _row(theme, 'State', s.devState.name),
        _row(theme, 'Feeding RPM', s.feedingRpm?.toString()),
        _row(theme, 'Grind RPM', s.grindRpm?.toString()),
        _row(
          theme,
          'Blade Gap',
          s.bladeGap != null ? '${s.bladeGap} µm' : null,
        ),
        _row(
          theme,
          'Humidity',
          s.humidity != null ? '${s.humidity} %RH' : null,
        ),
        _row(theme, 'Total Grinds', s.totalGrinds?.toString()),
        _row(theme, 'Cup Detect', s.cupDetect?.toString()),
        _row(theme, 'Auto Stop', s.autoStop?.toString()),
        _row(theme, 'Fast Clean', s.fastClean?.toString()),
        _row(theme, 'Brightness', s.brightness?.toString()),
        _row(theme, 'Standby (s)', s.standbySec?.toString()),
        _row(theme, 'Serial', s.snCode),
        _row(theme, 'Firmware', s.releaseVer),
        if (s.presets.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Presets', style: theme.textTheme.h3),
          ...s.presets.map((p) => _row(theme, p.name, p.uid, indent: true)),
        ],
        if (s.grindSections.isNotEmpty) ...[
          const SizedBox(height: 16),
          Text('Grind Sections', style: theme.textTheme.h3),
          ...s.grindSections.map(
            (g) => _row(theme, g.name, g.index.toString(), indent: true),
          ),
        ],
        const SizedBox(height: 24),
        Row(
          children: [
            ShadButton(
              child: const Text('Start'),
              onPressed: () => widget.grinder.start(),
            ),
            const SizedBox(width: 8),
            ShadButton(
              child: const Text('Stop'),
              onPressed: () => widget.grinder.stop(),
            ),
          ],
        ),
      ],
    );
  }

  Widget _row(
    ShadThemeData theme,
    String label,
    String? value, {
    bool indent = false,
  }) {
    return Padding(
      padding: EdgeInsets.only(left: indent ? 16.0 : 0.0, bottom: 8.0),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(label, style: theme.textTheme.muted),
          Text(value ?? '—', style: theme.textTheme.h4),
        ],
      ),
    );
  }
}
