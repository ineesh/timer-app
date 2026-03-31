package com.ain.timer

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas

import android.graphics.drawable.BitmapDrawable
import android.graphics.drawable.Drawable
import android.graphics.drawable.Icon
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class LiveUpdateModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "LiveUpdateModule"
    }

    private fun drawableToBitmap(drawable: Drawable): Bitmap {
        if (drawable is BitmapDrawable) {
            if (drawable.bitmap != null) {
                return drawable.bitmap
            }
        }
        val bitmap = if (drawable.intrinsicWidth <= 0 || drawable.intrinsicHeight <= 0) {
            Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888)
        } else {
            Bitmap.createBitmap(drawable.intrinsicWidth, drawable.intrinsicHeight, Bitmap.Config.ARGB_8888)
        }
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }

    private fun getLaunchPendingIntent(): PendingIntent? {
        val intent = reactApplicationContext.packageManager.getLaunchIntentForPackage(reactApplicationContext.packageName)
        return if (intent != null) {
            PendingIntent.getActivity(reactApplicationContext, 0, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        } else null
    }

    @ReactMethod
    fun checkAndRequestPromotedPermission() {
        // Only run check on newer Android 15/16 versions
        if (Build.VERSION.SDK_INT >= 35) {
            try {
                val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                
                // Reflect API 36 NotificationManager.canPostPromotedNotifications()
                val method = NotificationManager::class.java.getMethod("canPostPromotedNotifications")
                val isPromotedEnabled = method.invoke(notificationManager) as? Boolean ?: false
                
                if (!isPromotedEnabled) {
                    val intent = Intent("android.settings.APP_NOTIFICATION_PROMOTION_SETTINGS").apply {
                        putExtra("android.provider.extra.APP_PACKAGE", reactApplicationContext.packageName)
                        flags = Intent.FLAG_ACTIVITY_NEW_TASK
                    }
                    reactApplicationContext.startActivity(intent)
                }
            } catch (e: Exception) {
                Log.d("LiveUpdateModule", "Android 16 API not fully present yet or error: " + e.message)
            }
        }
    }

    @ReactMethod
    fun startLiveUpdate(startTimeMs: Double) {
        try {
            val channelId = "youtube-tracker"
            val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(channelId, "YouTube Tracker Service", NotificationManager.IMPORTANCE_HIGH)
                notificationManager.createNotificationChannel(channel)
            }

            val iconResId = reactApplicationContext.resources.getIdentifier("ic_launcher", "mipmap", reactApplicationContext.packageName)
            
            // Render the Android 16 Standard Promoted Notification (NO RemoteViews allowed!)
            val builder = Notification.Builder(reactApplicationContext, channelId)
                .setSmallIcon(if (iconResId != 0) iconResId else android.R.drawable.ic_menu_today)
                .setContentTitle("Focus Time")
                .setContentText("Total YouTube watch time: ")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setUsesChronometer(true)
                .setWhen(startTimeMs.toLong())
                
            // Inject the precise Android 16 DP2 "ProgressStyle" required to render the Pill layout
            try {
                if (Build.VERSION.SDK_INT >= 34) { // Android 16 Baklava classes are present in some DP configs
                    val styleClass = Class.forName("android.app.Notification\$ProgressStyle")
                    val styleInstance = styleClass.getConstructor().newInstance() as Notification.Style
                    
                    // Natively populate the Android 16 String on the Status Pill!
                    try {
                        val method = styleClass.getMethod("setShortCriticalText", CharSequence::class.java)
                        method.invoke(styleInstance, "YouTube Timer")
                    } catch (e: Exception) {}
                    
                    builder.setStyle(styleInstance)
                    Log.d("LiveUpdateModule", "Injected ProgressStyle successfully!")
                } else {
                    builder.setStyle(Notification.BigTextStyle().bigText("Tracking YouTube watch time..."))
                }
            } catch (e: Exception) {
                builder.setStyle(Notification.BigTextStyle().bigText("Tracking YouTube watch time (Fallback text)"))
            }

                
            // Attach Click intent! CRUCIAL for OS rules to promote it to a Pill!
            val pendingIntent = getLaunchPendingIntent()
            if (pendingIntent != null) {
                builder.setContentIntent(pendingIntent)
            }
            
            // Try formatting with the YouTube App Icon as the Large Colored Box
            try {
                val pm = reactApplicationContext.packageManager
                val ytDrawable = pm.getApplicationIcon("com.google.android.youtube")
                val ytBitmap = drawableToBitmap(ytDrawable)
                
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    builder.setLargeIcon(Icon.createWithBitmap(ytBitmap))
                } else {
                    @Suppress("DEPRECATION")
                    builder.setLargeIcon(ytBitmap)
                }
            } catch (e: Exception) {
                Log.d("LiveUpdateModule", "YouTube not installed or icon unavailable")
            }
                
            // Use Android EVENT Category (which Google Sports Scores use) to forcefully intercept "Live notifications" bin!
            builder.setCategory(Notification.CATEGORY_EVENT)
            
            // Invoke Android 16 Developer Preview API using Reflection unconditionally (it fails silently if API doesn't exist)
            try {
                val method = Notification.Builder::class.java.getMethod("setRequestPromotedOngoing", Boolean::class.javaPrimitiveType)
                method.invoke(builder, true)
                Log.d("LiveUpdateModule", "Android 16 SDK 36: Promoted Ongoing successfully requested.")
            } catch (e: Exception) {
                // Ignore gracefully. Not running Android 16 API 36 Preview.
            }

            // Publish Native Notification
            notificationManager.notify(8888, builder.build())
        } catch (e: Exception) {
            Log.e("LiveUpdateModule", "Error starting live update", e)
        }
    }

    @ReactMethod
    fun stopLiveUpdate(totalSeconds: Double) {
        try {
            val channelId = "youtube-tracker"
            val notificationManager = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            
            val iconResId = reactApplicationContext.resources.getIdentifier("ic_launcher", "mipmap", reactApplicationContext.packageName)

            val builder = Notification.Builder(reactApplicationContext, channelId)
                .setSmallIcon(if (iconResId != 0) iconResId else android.R.drawable.ic_menu_today)
                .setContentTitle("YouTube Timer Paused")
                .setContentText("Total focused time: ${totalSeconds.toInt()}s")
                .setOngoing(false)
                .setOnlyAlertOnce(true)
                
            val pendingIntent = getLaunchPendingIntent()
            if (pendingIntent != null) {
                builder.setContentIntent(pendingIntent)
            }
                
            notificationManager.notify(8888, builder.build())
        } catch (e: Exception) {
            Log.e("LiveUpdateModule", "Error stopping live update", e)
        }
    }
}
