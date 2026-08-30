import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:reaprime/src/plugins/plugin_manifest.dart';

void main() {
  const pluginDir = 'assets/plugins/print-the-shot.reaplugin';

  test('manifest parses and matches the bundled directory', () async {
    final json =
        jsonDecode(await File('$pluginDir/manifest.json').readAsString())
            as Map<String, dynamic>;

    final manifest = PluginManifest.fromJson(json);

    expect(manifest.id, 'print-the-shot.reaplugin');
    expect(manifest.id, pluginDir.split('/').last);
    expect(manifest.version, '1.3.0');
    expect(manifest.apiVersion, 1);
    expect(manifest.permissions, contains(PluginPermissions.log));
    expect(manifest.permissions, contains(PluginPermissions.api));
    expect(manifest.permissions, contains(PluginPermissions.emit));
    expect(manifest.permissions, contains(PluginPermissions.eventsShots));
  });

  test(
    'declares the ui/upload/debug http endpoints and events websocket',
    () async {
      final json =
          jsonDecode(await File('$pluginDir/manifest.json').readAsString())
              as Map<String, dynamic>;
      final manifest = PluginManifest.fromJson(json);

      final ids = manifest.api!.endpoints
          .map((endpoint) => endpoint.id)
          .toSet();
      expect(ids, containsAll(<String>{'ui', 'upload', 'debug', 'events'}));
      final httpEndpoints = manifest.api!.endpoints
          .where((endpoint) => endpoint.type == ApiEndpointType.http)
          .map((endpoint) => endpoint.id)
          .toSet();
      expect(httpEndpoints, containsAll(<String>{'ui', 'upload', 'debug'}));
      expect(
        manifest.api!.endpoints
            .where((endpoint) => endpoint.type == ApiEndpointType.websocket)
            .map((endpoint) => endpoint.id),
        contains('events'),
      );
    },
  );

  test('plugin.js is built and matches the manifest version', () async {
    final pluginJs = await File('$pluginDir/plugin.js').readAsString();
    final json =
        jsonDecode(await File('$pluginDir/manifest.json').readAsString())
            as Map<String, dynamic>;

    expect(pluginJs, contains('createPlugin'));
    expect(pluginJs, contains('shotStored'));
    expect(pluginJs, contains('host.emit'));
    expect(pluginJs, contains('"${json['version']}"'));
  });
}
