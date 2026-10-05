import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Bell, BellOff, X } from "lucide-react";
import { notificationService } from "@/lib/notifications";

export function NotificationPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission>('default');

  useEffect(() => {
    if (!notificationService.isSupported()) {
      return;
    }

    const currentPermission = notificationService.getPermissionStatus();
    setPermission(currentPermission);

    // If already granted, silently ensure server push subscription is registered
    if (currentPermission === 'granted') {
      notificationService.subscribeToServerPush().catch(() => {});
      return;
    }

    const dismissed = localStorage.getItem('notification-prompt-dismissed');
    if (currentPermission === 'default' && !dismissed) {
      const timer = setTimeout(() => setShowPrompt(true), 3000);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleEnable = async () => {
    const result = await notificationService.requestPermission();
    setPermission(result);
    setShowPrompt(false);
    if (result === 'granted') {
      localStorage.setItem('notifications-enabled', 'true');
      // Register push subscription with server
      await notificationService.subscribeToServerPush();
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('notification-prompt-dismissed', 'true');
  };

  if (!showPrompt || permission !== 'default') {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-4">
      <Card className="p-4 bg-gradient-to-br from-blue-600 to-purple-600 text-white border-0 shadow-xl max-w-sm">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-white/20 rounded-full">
            <Bell className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <h4 className="font-semibold mb-1">Enable Notifications</h4>
            <p className="text-sm text-white/80 mb-3">
              Get notified when your mining rewards are ready or when you earn new tokens!
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleEnable}
                className="bg-white text-blue-600 hover:bg-white/90"
              >
                Enable
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleDismiss}
                className="text-white hover:bg-white/20"
              >
                Not now
              </Button>
            </div>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 hover:bg-white/20 rounded"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </Card>
    </div>
  );
}

export function NotificationToggle() {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(true);

  useEffect(() => {
    setSupported(notificationService.isSupported());
    const permission = notificationService.getPermissionStatus();
    setEnabled(permission === 'granted');
  }, []);

  const handleToggle = async () => {
    if (!enabled) {
      const result = await notificationService.requestPermission();
      setEnabled(result === 'granted');
    }
  };

  if (!supported) {
    return null;
  }

  return (
    <Button
      variant={enabled ? "default" : "outline"}
      size="sm"
      onClick={handleToggle}
      className="gap-2"
    >
      {enabled ? (
        <>
          <Bell className="h-4 w-4" />
          Notifications On
        </>
      ) : (
        <>
          <BellOff className="h-4 w-4" />
          Enable Notifications
        </>
      )}
    </Button>
  );
}
